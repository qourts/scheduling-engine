import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import type { Schedule } from "@engine";
import { buildConfig } from "../domain/buildConfig.js";
import { inputsKey, newProject, type Project } from "../domain/project.js";
import { smallClubDay } from "../domain/samples.js";
import { createInlineRunner } from "../engine/inlineRunner.js";
import { createMemoryStore } from "../storage/store.js";
import { useWorkspace, WorkspaceProvider } from "./workspace.js";

const runner = createInlineRunner();
let schedule: Schedule;
let other: Schedule;

beforeAll(async () => {
  const { result } = await runner.generate(buildConfig(smallClubDay()), [], 1, 3000);
  schedule = result.options[0]!.schedule;
  other = result.options[result.options.length - 1]!.schedule;
});

const draftWithSchedule = (): Project => ({ ...newProject(smallClubDay()), working: { basedOn: "fastest_finish", schedule: structuredClone(schedule), locks: [] } });

/** Stands in for the screens: each button performs the same project update a real edit path performs. */
function Harness({ initial }: { initial: Project }) {
  const w = useWorkspace();
  useEffect(() => {
    w.importProject(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const p = w.project;
  if (!p) return null;
  const approve = () =>
    w.update((x) => {
      const revision = { id: "rev-approved", at: 1, label: "Approved", status: "approved" as const, schedule: structuredClone(x.working!.schedule), locks: [...x.working!.locks], acknowledgedRisks: [], inputsKey: inputsKey(x.spec, x.rules) };
      return { ...x, revisions: [...x.revisions, revision], status: "approved", approvedRevisionId: revision.id };
    });
  const edit = (fn: (x: Project) => Project) => () => w.update(fn);
  return (
    <>
      <output data-testid="status">{p.status}</output>
      {w.notice && <p data-testid="notice">{w.notice}</p>}
      <button onClick={approve}>approve</button>
      <button onClick={edit((x) => ({ ...x, working: { ...x.working!, schedule: { ...x.working!.schedule, assignments: x.working!.schedule.assignments.map((a, i) => (i === 0 ? { ...a, start: a.start + 5 } : a)) } } }))}>drag</button>
      <button onClick={edit((x) => ({ ...x, working: { ...x.working!, schedule: structuredClone(schedule) } }))}>undo</button>
      <button onClick={edit((x) => ({ ...x, working: { ...x.working!, locks: [x.working!.schedule.assignments[0]!.matchId] } }))}>lock</button>
      <button onClick={edit((x) => ({ ...x, status: "draft", approvedRevisionId: null, working: { basedOn: "balanced_operations", schedule: structuredClone(other), locks: [] } }))}>regenerate</button>
      <button onClick={edit((x) => ({ ...x, spec: { ...x.spec, recoveryMinutes: x.spec.recoveryMinutes + 5 } }))}>change setup</button>
    </>
  );
}

const setup = (initial: Project) =>
  render(
    <WorkspaceProvider runner={runner} store={createMemoryStore()}>
      <Harness initial={initial} />
    </WorkspaceProvider>,
  );

describe("approval is withdrawn centrally, whichever way the schedule or setup changes", () => {
  it("survives only the approval itself, then drops back to draft on every kind of edit", async () => {
    const user = userEvent.setup();
    for (const action of ["drag", "lock", "regenerate", "change setup"]) {
      const view = setup(draftWithSchedule());
      expect(await screen.findByTestId("status")).toHaveTextContent("draft");
      await user.click(screen.getByText("approve"));
      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("approved"));
      expect(screen.queryByTestId("notice")).toBeNull();
      await user.click(screen.getByText(action));
      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("draft"));
      expect(screen.getByTestId("notice")).toHaveTextContent(/approval was withdrawn/i);
      view.unmount();
    }
  });

  it("an undo that returns to the approved schedule after an edit still needs re-approval", async () => {
    const user = userEvent.setup();
    setup(draftWithSchedule());
    await screen.findByTestId("status");
    await user.click(screen.getByText("approve"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("approved"));
    await user.click(screen.getByText("drag"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("draft"));
    await user.click(screen.getByText("undo"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("draft"));
    await user.click(screen.getByText("approve"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("approved"));
  });

  it("an imported project claiming approval for a different schedule opens as a draft", async () => {
    const forged: Project = { ...draftWithSchedule(), status: "approved", approvedRevisionId: "rev-x", revisions: [{ id: "rev-x", at: 1, label: "x", status: "approved", schedule: structuredClone(other), locks: [], acknowledgedRisks: [], inputsKey: "whatever" }] };
    setup(forged);
    expect(await screen.findByTestId("status")).toHaveTextContent("draft");
  });
});
