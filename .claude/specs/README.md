# Specifications

**Note for Claude Agents:** For questions clarifications, improvements contact the project owner through the chat or ticket creation.

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
additional_info: Option<string>
related_spec: Option<string> // spec id
related_ticket: Option<string> // ticket id
pre_conditions: Option<OrderedList<string>>
sources: Option<List> // absolute path
expected_behaviour: List<string>
status: string
tests: OrderedList<string>
qa_report: Option<string>

## General Rules

Ubiquitous rules that all specifications must follow (where applicable).

- privacy-by-design, E2EE approach (eg. ECDH, PBKDF2, service authorization, JWT, OPAQUE, SHA256, ..)
- data-minimization
- early drop / deletetion, clearance of confidential or unused data
- modularization and decoupling of concerns in all services, modules and types of scripts (javascript, rust)
- DRY (Don't repeat yourself)
- update specs on refactoring, specs change, inconsistencies and contradictory specs
- all incoming data must be validated
- no shortcuts, stubs

## Enforceable Rules

A specification: 

- must not violate general rules
- must be defined for a single ui element, function, state or event
- if missing, must stop the interrupt the current coding task.
- if missing, must be defined before setting a task 'in-progress'
- must acknowledge the current app architecture, frameworks and build upon it.
- must be included into a ticket by its unique id.
