# Specifications

## Format, Schema, Storage

- one file per specification
- stored in folders that reflect the concern (eg. '/ui/', '/services/gateway')
- in machine readable yaml format

### Schema

Keys are mandatory. Values may be optional (empty). Descriptions must be ubiquitous. sources link to relevant files in the codebase.
tests must be either state-driven or event-driven.

---
id: unique string
description: string
additional_info: Option<String>
pre_conditions: Option<OrderedList<string>>
sources: Option<List>
expected_behaviour: List<string>
status: string
tests: OrderedList<string>
qa_report: Option<string>

## General Rules

Ubiquitous rules that all specifications must follow (where applicable).

- privacy-by-design approach (eg. service authorization, JWT, OPAQUE, SHA256, ..)
- data-minimization
- early drop / deletetion, clearance of confidential or unused data
- modularization of concerns in all types of scripts (javascript, rust)
- DRY (Don't repeat yourself)
- update specs on refactoring, specs change, inconsistencies and contradictory specs
- all incoming data must be validated
- no shortcuts, stubs

## Enforceable Rules

- A specification must not violate general rules
- A missing specification must stop the coding task.
- A missing specification must be defined before setting a task 'in-progress'
- Unit tests must be written if missing
- New specifications must acknowledge current app architecture, frameworks and build upon it.
-The Specification id must be included in the relevant ticket file if missing.

