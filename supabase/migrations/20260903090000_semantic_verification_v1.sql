ALTER TABLE job_receipts DROP CONSTRAINT IF EXISTS job_receipts_result_check;
ALTER TABLE job_receipts ADD CONSTRAINT job_receipts_result_check CHECK (result IN (
  'VERIFIED','VERIFIED_DELIVERY','CONTRACT_VERIFIED','CONTRACT_VERIFIED_DELIVERY',
  'SPEC_TEST_CONFLICT','TEST_ORACLE_SUSPECT','ACCEPTANCE_CRITERIA_CONFLICT',
  'ENGINEERING_REVIEW_REQUIRED','SUPERSEDED','INVALIDATED_FOR_SEMANTIC_SUCCESS',
  'PARTIALLY_VERIFIED','FAILED','UNVERIFIED','DISPUTED',
  'PERMISSION_VIOLATION','INVALID_EVIDENCE_CHAIN'
));

CREATE TABLE receipt_semantic_reviews (
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES job_receipts(id),
  review_contract_sha256 text NOT NULL CHECK(length(review_contract_sha256) = 64),
  outcome text NOT NULL CHECK(outcome IN (
    'CONTRACT_VERIFIED','SPEC_TEST_CONFLICT','TEST_ORACLE_SUSPECT',
    'ACCEPTANCE_CRITERIA_CONFLICT','ENGINEERING_REVIEW_REQUIRED'
  )),
  overall_status text NOT NULL CHECK(overall_status IN (
    'VERIFIED_DELIVERY','ENGINEERING_REVIEW_REQUIRED','SUPERSEDED','FAILED'
  )),
  evidence_chain_sha256 text NOT NULL CHECK(length(evidence_chain_sha256) = 64),
  review_json jsonb NOT NULL,
  review_sha256 text NOT NULL CHECK(length(review_sha256) = 64),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_receipt_semantic_reviews_receipt
  ON receipt_semantic_reviews(receipt_id, created_at);

CREATE OR REPLACE FUNCTION prevent_receipt_semantic_review_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Receipt semantic reviews are append-only';
END;
$$;

CREATE TRIGGER receipt_semantic_reviews_no_update
BEFORE UPDATE ON receipt_semantic_reviews
FOR EACH ROW EXECUTE FUNCTION prevent_receipt_semantic_review_mutation();

CREATE TRIGGER receipt_semantic_reviews_no_delete
BEFORE DELETE ON receipt_semantic_reviews
FOR EACH ROW EXECUTE FUNCTION prevent_receipt_semantic_review_mutation();
