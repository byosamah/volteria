---
name: backlog
description: Manage persistent backlog of tasks across sessions. Use when user says "backlog", "what tasks do we have", "add to backlog", or wants to track remaining work items.
---

# Backlog - Persistent Task Management

## Instructions

Read the backlog file at `.claude/backlog.md` and perform the requested action.

### Actions

**Show tasks** (`/backlog` with no args):
- Read `.claude/backlog.md`
- Display all tasks grouped by status (Pending, In Progress, Done)
- Show task ID, title, priority, and blocker if any
- Suggest which task to work on next (highest priority unblocked task)

**Add task** (`/backlog add <description>`):
- Append a new task to `.claude/backlog.md` with next available ID
- Ask user for: priority (high/medium/low), any blockers, and context
- Use TaskCreate to also track in current session

**Complete task** (`/backlog done <id>`):
- Mark task as done in `.claude/backlog.md` with completion date
- Move to Done section

**Remove task** (`/backlog remove <id>`):
- Remove task from `.claude/backlog.md`

**Work on task** (`/backlog do <id>`):
- Read the task details from `.claude/backlog.md`
- Mark as In Progress
- Use TaskCreate to track in current session
- Begin working on it

### Backlog File Format

The backlog lives at `.claude/backlog.md`. Each task has:
- **ID**: Sequential number (BL-1, BL-2, ...)
- **Title**: Short description
- **Status**: `pending` | `in_progress` | `done`
- **Priority**: `high` | `medium` | `low`
- **Created**: Date added
- **Completed**: Date finished (if done)
- **Blocker**: What's blocking this task (if any)
- **Context**: Why this task exists, what needs to happen, relevant files

### Rules
- Always read the backlog file before any operation
- Keep the file clean and well-formatted
- When completing a task, add the completion date
- When showing tasks, highlight blocked tasks clearly
- Suggest the next actionable task based on priority + no blockers
