-- Agent Identity production persistence V1
-- Identity documents are hash-bound in application code and append-only here.
-- Authenticated/anonymous clients may read only through RLS. All mutations are
-- service-role-only commands whose actor is re-authorized against durable rows.

alter table public.agents drop constraint if exists agents_pricing_model_check;
alter table public.agents add constraint agents_pricing_model_check
  check (pricing_model in ('FIXED', 'HOURLY', 'PER_RUN', 'FROM'));

create table public.agent_identity_profiles (
  agent_id uuid not null references public.agents(id) on delete restrict,
  revision integer not null check (revision > 0),
  profile_sha256 text not null check (profile_sha256 ~ '^[a-f0-9]{64}$'),
  previous_profile_sha256 text check (
    previous_profile_sha256 is null or previous_profile_sha256 ~ '^[a-f0-9]{64}$'
  ),
  controller_account_id uuid not null,
  profile_document jsonb not null check (jsonb_typeof(profile_document) = 'object'),
  recorded_at timestamptz not null,
  primary key (agent_id, revision),
  unique (profile_sha256),
  unique (agent_id, revision, profile_sha256)
);

create table public.agent_external_identity_owners (
  identity_key text primary key check (char_length(identity_key) between 5 and 1800),
  agent_id uuid not null,
  first_profile_revision integer not null,
  first_profile_sha256 text not null,
  reference_document jsonb not null check (jsonb_typeof(reference_document) = 'object'),
  created_at timestamptz not null,
  foreign key (agent_id, first_profile_revision, first_profile_sha256)
    references public.agent_identity_profiles(agent_id, revision, profile_sha256)
    on delete restrict
);

create index agent_identity_profiles_controller_idx
  on public.agent_identity_profiles(controller_account_id, agent_id, revision desc);
create index agent_external_identity_owners_agent_idx
  on public.agent_external_identity_owners(agent_id, first_profile_revision);

create or replace function private.agent_external_identity_key(p_reference jsonb)
returns text
language sql
immutable
strict
security invoker
set search_path = pg_catalog
as $$
  select concat_ws(
    ':',
    p_reference ->> 'system',
    lower(p_reference ->> 'namespace'),
    lower(coalesce(p_reference ->> 'network', '')),
    lower(p_reference ->> 'identifier')
  )
$$;

create or replace function private.enforce_agent_identity_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous public.agent_identity_profiles%rowtype;
  provider_auth_user_id uuid;
begin
  -- Serializing on the parent row closes the concurrent-revision race.
  perform 1 from public.agents agent where agent.id = new.agent_id for update;
  if not found then
    raise exception 'AGENT_IDENTITY_MARKETPLACE_AGENT_UNKNOWN' using errcode = '23503';
  end if;

  select profile.auth_user_id into provider_auth_user_id
  from public.agents agent
  join public.provider_profiles provider on provider.id = agent.provider_id
  join public.profiles profile on profile.id = provider.profile_id
  where agent.id = new.agent_id;

  if provider_auth_user_id is null or new.controller_account_id <> provider_auth_user_id then
    raise exception 'AGENT_IDENTITY_CONTROLLER_MISMATCH' using errcode = '23514';
  end if;

  if new.profile_document ->> 'schemaVersion' is distinct from '1'
    or new.profile_document ->> 'profileType' is distinct from 'AGENT_IDENTITY_PROFILE_V1'
    or new.profile_document ->> 'agentId' is distinct from new.agent_id::text
    or (new.profile_document ->> 'revision')::integer is distinct from new.revision
    or new.profile_document ->> 'profileSha256' is distinct from new.profile_sha256
    or (new.profile_document -> 'controller' ->> 'accountId')::uuid is distinct from new.controller_account_id
    or new.profile_document -> 'controller' ->> 'controllerType' is distinct from 'PLATFORM_ACCOUNT'
    or new.profile_document -> 'controller' ->> 'accountType' is distinct from 'USER'
    or new.profile_document -> 'controller' ->> 'relationship' is distinct from 'CONTROLS'
    or new.profile_document -> 'controller' ->> 'assurance' is distinct from 'PLATFORM_ACCOUNT_RELATIONSHIP'
    or new.profile_document -> 'controller' ->> 'legallyVerified' is distinct from 'false'
    or coalesce(new.profile_document ->> 'status' not in ('ACTIVE', 'DISABLED', 'REVOKED'), true)
    or jsonb_typeof(new.profile_document -> 'declaredCapabilities') is distinct from 'array'
    or jsonb_typeof(new.profile_document -> 'runtimeReferences') is distinct from 'array'
    or jsonb_typeof(new.profile_document -> 'externalIdentities') is distinct from 'array'
    or not (new.profile_document ? 'createdAt')
    or (new.profile_document ->> 'createdAt')::timestamptz > new.recorded_at
    or (new.profile_document ->> 'updatedAt')::timestamptz is distinct from new.recorded_at
  then
    raise exception 'AGENT_IDENTITY_PROFILE_DOCUMENT_INVALID' using errcode = '23514';
  end if;

  select identity.* into previous
  from public.agent_identity_profiles identity
  where identity.agent_id = new.agent_id
  order by identity.revision desc
  limit 1;

  if previous.agent_id is null then
    if new.revision <> 1
      or new.previous_profile_sha256 is not null
      or new.profile_document ->> 'previousProfileSha256' is not null
    then
      raise exception 'AGENT_IDENTITY_INITIAL_REVISION_INVALID' using errcode = '23514';
    end if;
  else
    if new.revision <> previous.revision + 1
      or new.previous_profile_sha256 is distinct from previous.profile_sha256
      or new.profile_document ->> 'previousProfileSha256' is distinct from previous.profile_sha256
      or new.profile_document -> 'controller' is distinct from previous.profile_document -> 'controller'
      or new.profile_document ->> 'createdAt' is distinct from previous.profile_document ->> 'createdAt'
      or new.recorded_at <= previous.recorded_at
    then
      raise exception 'AGENT_IDENTITY_REVISION_CHAIN_INVALID' using errcode = '23514';
    end if;

    if previous.profile_document ->> 'status' = 'REVOKED' then
      raise exception 'AGENT_IDENTITY_REVOKED_TERMINAL' using errcode = '23514';
    end if;
    if previous.profile_document ->> 'status' = 'DISABLED'
      and new.profile_document ->> 'status' = 'ACTIVE'
    then
      raise exception 'AGENT_IDENTITY_REENABLE_REQUIRES_SEPARATE_POLICY' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(previous.profile_document -> 'externalIdentities') old_reference
      where not exists (
        select 1
        from jsonb_array_elements(new.profile_document -> 'externalIdentities') new_reference
        where private.agent_external_identity_key(new_reference)
          = private.agent_external_identity_key(old_reference)
      )
    ) then
      raise exception 'AGENT_EXTERNAL_IDENTITY_HISTORY_MUTATION' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger agent_identity_profiles_validate_insert
before insert on public.agent_identity_profiles
for each row execute function private.enforce_agent_identity_revision();

create trigger agent_identity_profiles_append_only
before update or delete on public.agent_identity_profiles
for each row execute function private.reject_row_mutation();

create trigger agent_external_identity_owners_append_only
before update or delete on public.agent_external_identity_owners
for each row execute function private.reject_row_mutation();

create or replace function private.append_agent_identity_profile(
  p_auth_user_id uuid,
  p_profile jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  target_agent_id uuid;
  actor_profile_id uuid;
  actor_is_admin boolean;
  actor_owns_agent boolean;
  reference jsonb;
  reference_count integer;
  distinct_reference_count integer;
begin
  if p_auth_user_id is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'AGENT_IDENTITY_COMMAND_INVALID' using errcode = '22023';
  end if;

  target_agent_id := (p_profile ->> 'agentId')::uuid;

  select profile.id,
    exists (
      select 1 from public.profile_roles role
      where role.profile_id = profile.id and role.role = 'ADMIN'
    )
  into actor_profile_id, actor_is_admin
  from public.profiles profile
  where profile.auth_user_id = p_auth_user_id
    and profile.status = 'ACTIVE'
    and profile.deleted_at is null;

  select exists (
    select 1
    from public.agents agent
    join public.provider_profiles provider on provider.id = agent.provider_id
    where agent.id = target_agent_id
      and provider.profile_id = actor_profile_id
  ) into actor_owns_agent;

  if actor_profile_id is null or not (actor_owns_agent or actor_is_admin) then
    raise exception 'AGENT_IDENTITY_ACCESS_DENIED' using errcode = '42501';
  end if;

  select count(*), count(distinct private.agent_external_identity_key(item))
  into reference_count, distinct_reference_count
  from jsonb_array_elements(p_profile -> 'externalIdentities') item;

  if reference_count <> distinct_reference_count then
    raise exception 'EXTERNAL_IDENTITY_DUPLICATE' using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_profile -> 'externalIdentities') item
    join public.agent_external_identity_owners owner
      on owner.identity_key = private.agent_external_identity_key(item)
    where owner.agent_id <> target_agent_id
  ) then
    raise exception 'EXTERNAL_IDENTITY_CONFLICT' using errcode = '23505';
  end if;

  insert into public.agent_identity_profiles (
    agent_id,
    revision,
    profile_sha256,
    previous_profile_sha256,
    controller_account_id,
    profile_document,
    recorded_at
  ) values (
    target_agent_id,
    (p_profile ->> 'revision')::integer,
    p_profile ->> 'profileSha256',
    p_profile ->> 'previousProfileSha256',
    (p_profile -> 'controller' ->> 'accountId')::uuid,
    p_profile,
    (p_profile ->> 'updatedAt')::timestamptz
  );

  for reference in select value from jsonb_array_elements(p_profile -> 'externalIdentities')
  loop
    insert into public.agent_external_identity_owners (
      identity_key,
      agent_id,
      first_profile_revision,
      first_profile_sha256,
      reference_document,
      created_at
    ) values (
      private.agent_external_identity_key(reference),
      target_agent_id,
      (p_profile ->> 'revision')::integer,
      p_profile ->> 'profileSha256',
      reference,
      (reference ->> 'linkedAt')::timestamptz
    ) on conflict (identity_key) do nothing;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_profile -> 'externalIdentities') item
    join public.agent_external_identity_owners owner
      on owner.identity_key = private.agent_external_identity_key(item)
    where owner.agent_id <> target_agent_id
  ) then
    raise exception 'EXTERNAL_IDENTITY_CONFLICT' using errcode = '23505';
  end if;

  insert into public.audit_logs (
    actor_type,
    actor_profile_id,
    action,
    resource_type,
    resource_id,
    success,
    metadata
  ) values (
    case when actor_is_admin then 'ADMIN' else 'PROVIDER' end,
    actor_profile_id,
    case when (p_profile ->> 'revision')::integer = 1
      then 'AGENT_IDENTITY_REGISTERED'
      else 'AGENT_IDENTITY_REVISED'
    end,
    'agent_identity_profile',
    target_agent_id,
    true,
    jsonb_build_object(
      'revision', (p_profile ->> 'revision')::integer,
      'profileSha256', p_profile ->> 'profileSha256',
      'previousProfileSha256', p_profile ->> 'previousProfileSha256'
    )
  );

  return p_profile;
end;
$$;

create or replace function private.create_agent_with_identity(
  p_auth_user_id uuid,
  p_agent jsonb,
  p_profile jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  provider_id uuid;
  actor_profile_id uuid;
  target_agent_id uuid;
  created_at timestamptz;
  authentication_type text;
begin
  if p_auth_user_id is null
    or jsonb_typeof(p_agent) <> 'object'
    or jsonb_typeof(p_profile) <> 'object'
    or jsonb_typeof(p_agent -> 'skills') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'taskTypes') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'languages') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'operatingSystems') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'tools') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'requiredMcpServers') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'inputModes') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'outputModes') is distinct from 'array'
  then
    raise exception 'AGENT_CREATE_COMMAND_INVALID' using errcode = '22023';
  end if;

  select provider.id, profile.id into provider_id, actor_profile_id
  from public.provider_profiles provider
  join public.profiles profile on profile.id = provider.profile_id
  join public.profile_roles role on role.profile_id = profile.id and role.role = 'PROVIDER'
  where profile.auth_user_id = p_auth_user_id
    and profile.status = 'ACTIVE'
    and profile.deleted_at is null
    and provider.verification_status <> 'SUSPENDED'
  for update of provider;

  if provider_id is null then
    raise exception 'AGENT_CREATE_PROVIDER_ACCESS_DENIED' using errcode = '42501';
  end if;

  target_agent_id := (p_agent ->> 'id')::uuid;
  created_at := (p_agent ->> 'createdAt')::timestamptz;
  if p_profile ->> 'agentId' is distinct from target_agent_id::text
    or p_profile -> 'controller' ->> 'accountId' is distinct from p_auth_user_id::text
    or p_profile ->> 'createdAt' is distinct from p_agent ->> 'createdAt'
  then
    raise exception 'AGENT_IDENTITY_CREATE_BINDING_INVALID' using errcode = '23514';
  end if;

  insert into public.agents (
    id, provider_id, name, slug, description, version, input_modes, output_modes,
    supported_operating_systems, supported_tools, supported_languages, required_mcp_servers,
    pricing_model, base_price_cents, currency, availability, accepts_tasks, endpoint_type,
    visibility, status, verification_status, average_completion_seconds, total_completed_tasks,
    verified_success_rate, recent_reliability, current_workload, last_active_at, metadata,
    created_at, updated_at
  ) values (
    target_agent_id,
    provider_id,
    p_agent ->> 'name',
    p_agent ->> 'slug',
    p_agent ->> 'description',
    '1.0.0',
    array(select jsonb_array_elements_text(p_agent -> 'inputModes')),
    array(select jsonb_array_elements_text(p_agent -> 'outputModes')),
    array(select jsonb_array_elements_text(p_agent -> 'operatingSystems')),
    array(select jsonb_array_elements_text(p_agent -> 'tools')),
    array(select jsonb_array_elements_text(p_agent -> 'languages')),
    array(select jsonb_array_elements_text(p_agent -> 'requiredMcpServers')),
    p_agent ->> 'pricingModel',
    (p_agent ->> 'basePriceCents')::bigint,
    'USD',
    'OFFLINE',
    false,
    p_agent ->> 'endpointType',
    'PRIVATE',
    'ACTIVE',
    'PENDING',
    7200,
    0,
    0,
    1,
    0,
    created_at,
    jsonb_build_object('source', 'DONE_LAYER_SERVER_COMMAND'),
    created_at,
    created_at
  );

  insert into public.agent_skills (agent_id, skill)
  select target_agent_id, skill
  from (select distinct jsonb_array_elements_text(p_agent -> 'skills') as skill) valueset;

  insert into public.agent_task_types (agent_id, task_type)
  select target_agent_id, task_type
  from (select distinct jsonb_array_elements_text(p_agent -> 'taskTypes') as task_type) valueset;

  insert into public.agent_mcp_servers (agent_id, server_name, transport_type, required)
  select target_agent_id, server_name, 'OTHER', true
  from (select distinct jsonb_array_elements_text(p_agent -> 'requiredMcpServers') as server_name) valueset;

  authentication_type := case p_agent ->> 'authenticationType'
    when 'API_KEY' then 'BEARER'
    when 'OAUTH' then 'OAUTH2'
    when 'A2A_METADATA' then 'A2A'
    else p_agent ->> 'authenticationType'
  end;

  insert into public.agent_endpoints (
    agent_id, endpoint_type, endpoint_url, agent_card_url, authentication_type
  ) values (
    target_agent_id,
    p_agent ->> 'endpointType',
    p_agent ->> 'endpointUrl',
    case when p_agent ->> 'endpointType' = 'A2A' then p_agent ->> 'endpointUrl' else null end,
    authentication_type
  );

  perform private.append_agent_identity_profile(p_auth_user_id, p_profile);

  insert into public.audit_logs (
    actor_type, actor_profile_id, action, resource_type, resource_id, success, metadata
  ) values (
    'PROVIDER', actor_profile_id, 'AGENT_CREATED', 'agent', target_agent_id, true,
    jsonb_build_object('endpointType', p_agent ->> 'endpointType')
  );

  return jsonb_build_object(
    'agentId', target_agent_id::text,
    'slug', p_agent ->> 'slug',
    'profile', p_profile
  );
end;
$$;

create or replace function public.rpc_get_agent_identity(
  p_agent_id uuid,
  p_revision integer default null
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select identity.profile_document
  from public.agent_identity_profiles identity
  where identity.agent_id = p_agent_id
    and (p_revision is null or identity.revision = p_revision)
  order by identity.revision desc
  limit 1
$$;

create or replace function public.rpc_create_agent_with_identity(
  p_auth_user_id uuid,
  p_agent jsonb,
  p_profile jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = pg_catalog, public
as $$
  select private.create_agent_with_identity(p_auth_user_id, p_agent, p_profile)
$$;

create or replace function public.rpc_append_agent_identity_revision(
  p_auth_user_id uuid,
  p_profile jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = pg_catalog, public
as $$
  select private.append_agent_identity_profile(p_auth_user_id, p_profile)
$$;

revoke all on public.agent_identity_profiles, public.agent_external_identity_owners
  from public, anon, authenticated;
grant all on public.agent_identity_profiles, public.agent_external_identity_owners to service_role;
grant select on public.agent_identity_profiles to anon, authenticated;

alter table public.agent_identity_profiles enable row level security;
alter table public.agent_external_identity_owners enable row level security;

create policy agent_identity_profiles_catalog_select
on public.agent_identity_profiles for select to anon, authenticated
using ((select private.can_view_agent(agent_id)));

revoke all on function private.agent_external_identity_key(jsonb) from public, anon, authenticated;
revoke all on function private.enforce_agent_identity_revision() from public, anon, authenticated;
revoke all on function private.append_agent_identity_profile(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.create_agent_with_identity(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function private.agent_external_identity_key(jsonb) to service_role;
grant execute on function private.enforce_agent_identity_revision() to service_role;
grant execute on function private.append_agent_identity_profile(uuid, jsonb) to service_role;
grant execute on function private.create_agent_with_identity(uuid, jsonb, jsonb) to service_role;

revoke all on function public.rpc_get_agent_identity(uuid, integer) from public, anon, authenticated;
revoke all on function public.rpc_create_agent_with_identity(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_append_agent_identity_revision(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_get_agent_identity(uuid, integer) to anon, authenticated;
grant execute on function public.rpc_create_agent_with_identity(uuid, jsonb, jsonb) to service_role;
grant execute on function public.rpc_append_agent_identity_revision(uuid, jsonb) to service_role;

comment on table public.agent_identity_profiles is
  'Append-only, hash-bound Agent Identity profile revisions.';
comment on table public.agent_external_identity_owners is
  'Immutable first ownership claim for each canonical external Agent identity key.';
