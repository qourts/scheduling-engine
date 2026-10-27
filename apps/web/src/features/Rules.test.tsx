import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { clubWeekendOpen } from "../domain/samples.js";
import { createInlineRunner } from "../engine/inlineRunner.js";
import { createMemoryStore } from "../storage/store.js";
import { useWorkspace, WorkspaceProvider } from "../state/workspace.js";
import { Rules } from "./Rules.js";

function Boot() {
  const w = useWorkspace();
  useEffect(() => {
    if (!w.project) w.createProject(clubWeekendOpen());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return w.project ? (
    <>
      <Rules onNext={() => undefined} />
      <output data-testid="rule-count">{w.project.rules.length}</output>
      <output data-testid="strengths">{w.project.rules.map((r) => r.instruction.strength).join(",")}</output>
    </>
  ) : null;
}

const setup = () =>
  render(
    <WorkspaceProvider runner={createInlineRunner()} store={createMemoryStore()}>
      <Boot />
    </WorkspaceProvider>,
  );

describe("special rules screen", () => {
  it("will not confirm a rule whose wording does not say hard or preferred until the operator chooses", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByLabelText(/what should the schedule respect/i), "Reserve Court 10 for medal matches.");
    await user.click(await screen.findByRole("button", { name: "Interpret" }));

    const blocked = await screen.findByRole("button", { name: /choose hard or preferred first/i });
    expect(blocked).toBeDisabled();
    expect(screen.getByTestId("rule-count")).toHaveTextContent("0");

    await user.click(screen.getByLabelText(/mandatory: never broken/i));
    const confirm = await screen.findByRole("button", { name: "Confirm rule" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(screen.getByTestId("rule-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("strengths")).toHaveTextContent("mandatory");
  });

  it("applies an explicit hard rule only after the operator confirms it, and keeps unsupported requests out", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByLabelText(/what should the schedule respect/i), "Court 3 is unavailable 12:00-13:30 on day 1. Delay everything if it rains.");
    await user.click(await screen.findByRole("button", { name: "Interpret" }));

    expect(await screen.findByText(/not understood, nothing was applied/i)).toBeInTheDocument();
    expect(screen.getByTestId("rule-count")).toHaveTextContent("0");
    await user.click(await screen.findByRole("button", { name: "Confirm rule" }));
    await waitFor(() => expect(screen.getByTestId("rule-count")).toHaveTextContent("1"));
  });
});
