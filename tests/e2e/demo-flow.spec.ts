import { expect, test, type Page } from "@playwright/test";

type TaskAggregateResponse = {
  task: {
    status: string;
    acceptanceChecks: Array<{ id: string; required: boolean }>;
  };
  evidence: Array<{ id: string; sha256: string }>;
  verificationResults: Array<{ checkId: string; status: string }>;
  ledgerEntries: Array<{ entryType: string; amountCents: number }>;
};

async function fetchTask(page: Page, taskId: string): Promise<TaskAggregateResponse> {
  const response = await page.evaluate(async (id) => {
    const result = await fetch(`/api/tasks/${id}`, { credentials: "same-origin" });
    return {
      ok: result.ok,
      status: result.status,
      body: (await result.json()) as TaskAggregateResponse,
    };
  }, taskId);
  expect(response.ok, `Task API returned HTTP ${response.status}`).toBe(true);
  return response.body;
}

test("customer completes the persisted Proof-of-Done demo", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/sign-in");
  await expect(page).toHaveTitle(/Sign in.*DoneLayer/);
  await expect(page.getByRole("heading", { name: "Enter the DoneLayer demo" })).toBeVisible();

  await page.getByRole("button", { name: /Continue as customer/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
  await expect(page.getByRole("heading", { name: "Good evening, Nick" })).toBeVisible();

  await page.getByRole("button", { name: "Run Full Demo" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\?autorun=1$/);
  await expect(page.getByRole("heading", { name: "Fix failing authentication tests in a sample repository" })).toBeVisible();

  const taskId = new URL(page.url()).pathname.split("/").at(-1);
  expect(taskId).toBeTruthy();

  await expect(page.getByText("Released", { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/^6 of 6 required checks passed$/)).toBeVisible();
  await expect(page.getByText("Released after acceptance", { exact: true })).toBeVisible();

  const completed = await fetchTask(page, taskId!);
  expect(completed.task.status).toBe("COMPLETED");
  expect(completed.evidence.length).toBeGreaterThan(0);
  expect(completed.evidence.every((artifact) => /^[a-f0-9]{64}$/i.test(artifact.sha256))).toBe(true);
  for (const check of completed.task.acceptanceChecks.filter((candidate) => candidate.required)) {
    expect(completed.verificationResults.find((result) => result.checkId === check.id)?.status).toBe("PASSED");
  }
  expect(completed.ledgerEntries.some((entry) => entry.entryType === "RELEASE" && entry.amountCents > 0)).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Fix failing authentication tests in a sample repository" })).toBeVisible();
  await expect(page.getByText("Released", { exact: true })).toBeVisible();
  await expect(page.getByText(/^6 of 6 required checks passed$/)).toBeVisible();
  expect((await fetchTask(page, taskId!)).task.status).toBe("COMPLETED");

  await page.getByRole("link", { name: "Agent Hall" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  const search = page.getByRole("textbox", { name: "Search agents" });
  await search.fill("Repository QA");
  await expect(page.getByText("Repository QA Agent", { exact: true })).toBeVisible();
  await page.getByLabel("Online only").check();
  await expect(page.getByRole("heading", { name: "No agents match these filters" })).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test("public account and documentation routes render", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page).toHaveTitle(/Create account.*DoneLayer/);
  await expect(page.getByRole("heading", { name: "Create your DoneLayer workspace" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account types" })).toBeVisible();

  await page.goto("/docs");
  await expect(page).toHaveTitle(/Docs.*DoneLayer/);
  await expect(page.getByRole("heading", { name: "Operate the completion marketplace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worker CLI" })).toBeVisible();
});
