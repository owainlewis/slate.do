import { agentIDForAssignee, assigneeForTask, availableAgentHandle, buildAssignees, mentionHandle, resolvedAssigneeKey } from "@/lib/assignees"

test.each([
  ["Codex", "codex"],
  ["Research Agent", "research_agent"],
  ["Éditor 2", "editor_2"],
  ["123 Builder", "builder"],
  ["🤖", "agent"],
])("creates a mention-safe handle from %s", (name, expected) => {
  expect(mentionHandle(name, "agent")).toBe(expected)
})

test("builds one human and named agent options with unique handles", () => {
  const options = buildAssignees(
    { id: "owner", email: "owain@example.com", displayName: "Owain Lewis" },
    [
      { id: "codex", displayName: "Codex" },
      { id: "owain-agent", displayName: "Owain" },
    ],
  )

  expect(options.map(option => [option.key, option.handle])).toEqual([
    ["human", "owain"],
    ["agent:codex", "codex"],
    ["agent:owain-agent", "owain_2"],
  ])
  expect(assigneeForTask({ assigneeAgentId: "codex" }, options).handle).toBe("codex")
  expect(assigneeForTask({ assigneeAgentId: "" }, options).handle).toBe("owain")
  expect(agentIDForAssignee("human")).toBe("")
  expect(agentIDForAssignee("agent:codex")).toBe("codex")
  expect(availableAgentHandle("Owain", options)).toBe("owain_3")
  expect(availableAgentHandle("Owain", options, "agent:owain-agent")).toBe("owain_2")
  expect(resolvedAssigneeKey("agent:missing", options)).toBeUndefined()
  expect(assigneeForTask({ assigneeAgentId: "missing" }, options)).toMatchObject({ kind: "agent", handle: "unavailable_agent" })
})
