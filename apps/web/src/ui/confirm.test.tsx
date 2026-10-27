import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ConfirmProvider, useConfirm } from "./confirm.js";

function Harness() {
  const confirm = useConfirm();
  const [result, setResult] = useState("none");
  return (
    <>
      <button onClick={async () => setResult((await confirm({ title: "Delete it?", body: "This cannot be undone.", confirmLabel: "Delete", tone: "danger" })) ? "yes" : "no")}>ask</button>
      <output data-testid="result">{result}</output>
    </>
  );
}

const setup = () => render(<ConfirmProvider><Harness /></ConfirmProvider>);

describe("branded confirmation dialog", () => {
  it("is an accessible alert dialog that resolves true on confirm", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("ask"));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete it?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("This cannot be undone.");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("yes"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("focuses Cancel first for a destructive action, and Escape cancels", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("ask"));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("no"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("returns focus to the control that opened it", async () => {
    const user = userEvent.setup();
    setup();
    const opener = screen.getByText("ask");
    await user.click(opener);
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
