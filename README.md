# Unity Preview Editor (UPE)

A browser-based preview editor for **animation, VFX, materials and shaders**, built on three.js and driven by an AI assistant over the [Model Context Protocol](https://modelcontextprotocol.io). Design in the preview, then send the result to **Unity** or **Unreal Engine 5** with one click.

The assistant does the authoring through MCP tools while you watch live in the editor and tweak values by hand. Nothing is ever sent to an engine on its own: export happens only when you press send.

> Formerly known as *Anim Ref*.

## Modes

| Mode | What it does | Exports to |
| --- | --- | --- |
| **Animation** | Keyframed animation on a Mixamo/Humanoid rig | Unity `.anim`, Unreal `AnimSequence` |
| **VFX** | Layered particle effects that map one-to-one onto Unity's `ParticleSystem` | Unity prefab, Unreal Niagara System |
| **Material** | Unity materials (URP Lit/Unlit/Particles or custom shaders) on a sphere, character or prop | Unity `.mat` |
| **Shader** | Custom shaders in UPE-SL (a Unity HLSL subset), previewed as GLSL | Unity URP `.shader` |
| **Model** | GLB/FBX/OBJ viewer: dimensions, triangles, parts, materials, textures, bones, clay/normal/UV/wireframe/skeleton views | View only |

## Quick start

Requires Node.js 18 or newer.

```bash
git clone https://github.com/Quiry-AAK/UnityAnimationRef.git
cd UnityAnimationRef
npm install
npm start
```

The editor opens at <http://localhost:5177>. Set the `UPE_PORT` environment variable to change the port.

## Connect it to an AI assistant (MCP)

Register the MCP server once with Claude Code, using the absolute path to your clone:

```bash
claude mcp add unity-preview -- node /absolute/path/to/UnityAnimationRef/mcp.js
```

Alternatively, copy [`.mcp.json.example`](.mcp.json.example) to `.mcp.json` in your project and fix the path. Once the MCP server is running, the editor server starts automatically, and each chat session gets its own port.

## Sending to Unreal Engine 5

Requirements: a running UE5 editor with the `UE_MCP_Bridge` plugin from [ue-mcp](https://www.npmjs.com/package/ue-mcp) installed in the project. UPE launches `npx ue-mcp@<version> <uproject>` itself, picking the version from the project's bridge plugin (it can also be chosen by hand in the panel).

Open the **Unreal** panel on the right (project, MCP target, ue-mcp version, content path, target skeleton for animation), then use **Send to Unreal** in the top bar (`Ctrl+Shift+Enter`) or the MCP tools `send_vfx_to_unreal` and `send_animation_to_unreal`.

- **VFX** becomes a Niagara System at `<content path>/NS_<name>` (default `/Game/UPE/VFX`).
- **Animation** becomes an AnimSequence at `<content path>/A_<name>` (default `/Game/UPE/Animations`), written onto the skeleton of the matching Mixamo character in Unreal.

No scripts are installed into the editor. Details and verification status: [docs/UNREAL.md](docs/UNREAL.md).

## Sending to Unity

Set the Unity project folder (the one containing `Assets` and `ProjectSettings`) in the **Unity** panel or with `set_unity_project`. The importer scripts from [`unity/`](unity) are installed into the project under `Assets/Editor/AnimRef/` automatically and updated on every send.

## MCP tools

- **General:** `get_status`, `set_editor_mode`
- **Animation:** `set_keys`, `set_animation`, `get_animation`, `clear_keys`, `sample_pose`, `get_user_edits`, `render_frame`, `list/save/load/delete_animation`, `list_props`, `attach/update/detach_prop`, `list_models`, `load_model`, `export_gif`, `export_for_unity`, `send_to_unity`, `send_animation_to_unreal`
- **VFX:** `vfx_reference` (call this first), `get_vfx`, `set_vfx`, `update_vfx`, `add_emitter`, `remove_emitter`, `get_vfx_user_edits`, `render_vfx`, `fit_arc_from_animation`, `list/save/load/delete_vfx`, `list_vfx_textures`, `send_vfx_to_unity`, `send_vfx_to_unreal`
- **Material and shader:** `material_reference` (call this first), `list/get/new/set/update/save/load/delete_material`, `list/get/new/set/update/save/load/delete_shader`, `assign_material`, `get/set_lighting`, `render_material`, `get_material_user_edits`, `get_shader_user_edits`, `list_material_textures`, `send_material_to_unity`, `send_shader_to_unity`
- **Model:** `list_model_files`, `view_model`, `get_model_view`, `render_model`
- **Targets:** `get_unity_info`, `set_unity_project`, `get_unreal_info`, `set_unreal_project`

## Repository layout

| Path | Contents |
| --- | --- |
| `public/` | The editor: animation and mode system (`app.js`), VFX (`vfx*.js`), material and shader modes (`material.js`), model viewer (`model.js`), UPE-SL to GLSL compiler (`shader-compile.js`), format schemas (`*-schema.js`) |
| `lib/` | Exporters and clients: `shader-hlsl.js` (UPE shader to Unity URP), `unreal-vfx.js` (VFX to Niagara), `unreal-anim.js` (animation to AnimSequence), `unreal-mcp-client.js` (ue-mcp client) |
| `unity/` | Unity editor scripts, installed into the target project on export |
| `docs/` | Format and integration references: [VFX](docs/VFX.md), [Material](docs/MATERIAL.md), [Unreal](docs/UNREAL.md) |
| `tools/` | Texture generators, an end-to-end MCP smoke test (`npm run smoke`), converter tests |
| `animations/`, `vfx/`, `shaders/`, `materials/` | Saved libraries as JSON, plus generated textures |
| `models/`, `meshes/`, `props/` | Your own characters, meshes and props. Large binaries are not in the repository, so add your own |

More usage notes, shortcuts and technical details: [NOTLAR.md](NOTLAR.md) (Turkish).

## Development

```bash
npm start            # run the editor
npm run smoke        # MCP end-to-end test
npm run hlsl-test    # UPE shader to HLSL generator test
npm run textures     # regenerate built-in textures
```

## Documentation language

The reference documents in `docs/` and `NOTLAR.md` are currently written in Turkish. The README and the editor's tool descriptions are in English.
