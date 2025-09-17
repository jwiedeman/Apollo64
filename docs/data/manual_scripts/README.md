# Manual Action Scripts

Manual action scripts drive deterministic crew actions, checklist overrides, and resource adjustments while the simulation runs in headless/CLI mode. They enable Milestone M1 regression runs to mimic manual crew responses or scripted deviations without relying on interactive input.

## File Format

Scripts are UTF-8 JSON files. The root can either be an array of action objects or an object with an `actions` array. Each action must include a `type` field and a GET timestamp.

| Field | Required | Description |
| --- | --- | --- |
| `type` | ✔️ | `"checklist_ack"`, `"resource_delta"`, or `"propellant_burn"`. |
| `get` / `time` / `get_seconds` | ✔️ | Mission time to execute. Accepts `HHH:MM:SS` or seconds. |
| `id` |  | Optional label for log output; defaults to `<type>_<index>`. |
| `retry_window_seconds` / `retry_until` |  | Optional retry window if prerequisites are not yet met (e.g., event still arming). |
| `note` |  | Optional annotation recorded in the mission log. |
| `source` |  | Overrides the `source` label used when emitting resource updates. |

### Action Types

#### `checklist_ack`

Acknowledges checklist steps for an active event. Fields:

- `event_id` (required) – Identifier matching the scheduler/event dataset.
- `count` (optional, default `1`) – Number of steps to acknowledge on this tick.
- `actor` (optional, default `"MANUAL_CREW"`) – Logged actor string.

If the event is not yet active, add `retry_window_seconds` to retry until the window closes.

#### `resource_delta`

Applies an object of deltas to the resource model using the same shape as event `success_effects` / `failure_effects` entries. Nested objects are supported—for example:

```json
{
  "type": "resource_delta",
  "get": "012:15:00",
  "effect": {
    "propellant": {
      "csm_rcs_kg": -2.5
    },
    "power": {
      "fuel_cell_load_kw": 0.3
    }
  }
}
```

#### `propellant_burn`

Convenience wrapper that subtracts propellant from a named tank. Fields:

- `tank` / `tank_key` / `propellant` (required) – Tank identifier (e.g., `"csm_rcs"`, `"lm_descent"`).
- `amount_kg` or `amount_lb` (required) – Consumption amount; pounds are converted to kilograms automatically.

## Example

```json
[
  {
    "id": "PTC_ENABLE",
    "type": "checklist_ack",
    "event_id": "COAST_004",
    "get": "004:50:00",
    "count": 3,
    "retry_window_seconds": 120,
    "note": "Manual crew acknowledges PTC entry"
  },
  {
    "id": "PTC_TRIM_PROP",
    "type": "propellant_burn",
    "get": "004:52:00",
    "tank": "csm_rcs",
    "amount_lb": 1.2,
    "note": "Trim pulses during PTC capture"
  },
  {
    "id": "CONS_CHECK",
    "type": "resource_delta",
    "get": "012:10:00",
    "effect": {
      "power": {
        "fuel_cell_load_kw": -0.2
      }
    },
    "source": "manual_script",
    "note": "Load shed after consumables review"
  }
]
```

## Running with the CLI Harness

1. Disable auto-advance if the script handles checklist steps: add `--manual-checklists` when launching the simulation.
2. Provide the script path with `--manual-script <path>`.
3. (Optional) Capture the deterministic mission log with `--log-file <output.json>` (add `--log-pretty` for human-readable JSON).

Example:

```bash
npm start -- --manual-checklists --manual-script docs/data/manual_scripts/example_ptc.json --log-file out/ptc_run.json --log-pretty --until 020:00:00
```

Scripts execute at the simulation tick closest to the requested GET and respect retry windows for events that arm slightly later than the target timestamp.

## Recording Auto-Advance Runs

To generate a manual action script directly from the auto crew, run the simulator with the new recorder flag:

```bash
npm start -- --until 015:00:00 --record-manual-script out/auto_checklists.json
```

While the auto crew acknowledges checklist steps, the recorder captures each acknowledgement (and associated GET) into `out/auto_checklists.json`. The exported file includes metadata plus an `actions` array ready to feed back into the CLI with `--manual-script`. This enables deterministic parity tests by replaying the recorded script with `--manual-checklists` to confirm manual vs. auto runs stay in sync.

## Automated Parity Runner

To validate parity without managing scripts manually, use the bundled harness:

```bash
npm run parity -- --until 015:00:00 --output out/parity.json
```

The tool performs two back-to-back simulations (auto-advance followed by manual replay), compares event status counts, resource snapshots, and autopilot metrics, and prints a PASS/FAIL summary. The optional `--output` flag captures the JSON diff report for archival or CI gating. Additional options:

- `--tolerance <value>` – Adjust numeric comparison tolerance.
- `--quiet` / `--verbose` – Toggle mission log verbosity during the paired runs.

Parity reports summarize the recorded manual action script, making it easy to drop the same actions into bespoke regression scenarios.
