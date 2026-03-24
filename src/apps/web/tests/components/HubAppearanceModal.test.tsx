import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { HubAppearanceModal } from "../../components/HubAppearanceModal";
import { renderWithQueryClient } from "../test-utils";
import type { HubColorKey, HubIconKey } from "../../lib/hubAppearance";

describe("HubAppearanceModal", () => {
  it("submits the selected icon and color in create mode", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();

    function Wrapper() {
      const [name, setName] = useState("Launch Hub");
      const [description, setDescription] = useState("Docs");
      const [iconKey, setIconKey] = useState<HubIconKey>("stack");
      const [colorKey, setColorKey] = useState<HubColorKey>("slate");

      return (
        <HubAppearanceModal
          mode="create"
          title="Create a new hub"
          subtitle="Shape the look of your hub."
          submitLabel="Create hub"
          onClose={() => {}}
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit({
              name,
              description,
              iconKey,
              colorKey,
            });
          }}
          name={name}
          description={description}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          iconKey={iconKey}
          colorKey={colorKey}
          onIconKeyChange={setIconKey}
          onColorKeyChange={setColorKey}
        />
      );
    }

    renderWithQueryClient(<Wrapper />);

    await user.click(screen.getByLabelText("Select Launch icon"));
    await user.click(screen.getByLabelText("Select Blue color"));
    await user.click(screen.getByRole("button", { name: "Create hub" }));

    expect(handleSubmit).toHaveBeenCalledWith({
      name: "Launch Hub",
      description: "Docs",
      iconKey: "rocket",
      colorKey: "blue",
    });
  });
});
