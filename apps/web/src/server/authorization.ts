import { redirect } from "next/navigation";
import type { TaskAggregate } from "@donelayer/database";
import { getActor, type Actor, type AppRole } from "./auth";

export async function requirePageActor(allowed: AppRole[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!allowed.includes(actor.role)) {
    redirect(actor.role === "PROVIDER" ? "/provider" : actor.role === "ADMIN" ? "/admin" : "/customer");
  }
  return actor;
}

export function canViewTask(actor: Actor, aggregate: TaskAggregate): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "CUSTOMER") return aggregate.task.customerId === actor.id;
  return aggregate.assignment?.providerId === actor.id;
}

export function canOperateTask(actor: Actor, aggregate: TaskAggregate): boolean {
  return actor.role === "ADMIN" || (actor.role === "CUSTOMER" && aggregate.task.customerId === actor.id);
}
