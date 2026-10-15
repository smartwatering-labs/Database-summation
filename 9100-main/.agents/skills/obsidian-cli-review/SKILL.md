---
name: obsidian-cli-review
description: Use for read-only review of notes in the 基础素材 Obsidian vault via Obsidian CLI. Writes require explicit user approval.
---

vault=基础素材
path=/Users/zzn/ZZN的文件/基础素材

Use built-in `obsidian-cli` skill for command syntax/examples; do not duplicate CLI reference here.

On "CLI unable to find Obsidian":
request network + rw /Users/zzn/.obsidian-cli.sock
retry: obsidian version && obsidian vault

Default read-only. Ask before write/delete/move/property changes.
