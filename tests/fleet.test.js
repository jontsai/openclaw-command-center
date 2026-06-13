const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  checkCommandCenter,
  checkGateway,
  getFleetAgents,
  runCommandCheck,
} = require("../src/fleet");

describe("fleet module", () => {
  it("runs command checks without a shell", () => {
    const result = runCommandCheck({
      command: process.execPath,
      args: ["-e", "process.stdout.write('ok')"],
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.output, "ok");
  });

  it("detects command center version from command output", () => {
    const result = checkCommandCenter({
      command: process.execPath,
      args: ["-e", "process.stdout.write('1.2.3')"],
    });

    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.version, "1.2.3");
  });

  it("supports static command center checks", () => {
    const result = checkCommandCenter({ type: "static", installed: true, version: "1.4.1" });

    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.version, "1.4.1");
  });

  it("parses gateway JSON health output", () => {
    const result = checkGateway({
      type: "command",
      command: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify({ ok: true, status: 'live' }))"],
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, "live");
  });

  it("supports static gateway checks", () => {
    const result = checkGateway({ type: "static", ok: true, status: "live" });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, "live");
  });

  it("returns configured fleet agents with check results", () => {
    const fleet = getFleetAgents({
      fleet: {
        agents: [
          {
            id: "test-agent",
            name: "Test Project",
            agentName: "Tester",
            commandCenter: {
              command: process.execPath,
              args: ["-e", "process.stdout.write('9.9.9')"],
            },
            gateway: {
              type: "command",
              command: process.execPath,
              args: ["-e", "process.stdout.write(JSON.stringify({ ok: true, status: 'live' }))"],
            },
          },
        ],
      },
    });

    assert.strictEqual(fleet.length, 1);
    assert.strictEqual(fleet[0].id, "test-agent");
    assert.strictEqual(fleet[0].commandCenter.installed, true);
    assert.strictEqual(fleet[0].gateway.ok, true);
  });
});
