# AtomQuest Hackathon 1.0 Submission

## Project

**In-House Goal Setting & Tracking Portal**

## Working Demo Link

Local demo:

```text
http://127.0.0.1:3000
```

Run command:

```bash
npm start
```

Hosted demo URL:

```text
PASTE_HOSTED_DEMO_URL_HERE
```

## Source Code Repository

```text
PASTE_GITHUB_GITLAB_BITBUCKET_REPOSITORY_URL_HERE
```

## Architecture Diagram

Architecture diagram file:

```text
docs/architecture.svg
```

Architecture explanation:

```text
docs/architecture.md
```

## Demo Credentials / Role Switch

The portal includes a **Demo login** selector in the sidebar, so evaluators can switch user journeys without passwords.

| Role | Demo User | Email |
| --- | --- | --- |
| Employee | Aarav Mehta | employee@atomquest.local |
| Manager L1 | Mira Shah | manager@atomquest.local |
| Admin / HR | Harshita Rao | admin@atomquest.local |

## Suggested Evaluation Flow

1. Start the server with `npm start`.
2. Open `http://127.0.0.1:3000`.
3. Use the sidebar **Demo login** selector.
4. Login as Admin / HR and open the **Phase 1 - Goal Setting** window from **Admin / HR**.
5. Login as Employee and create/submit goals.
6. Login as Manager and approve or return the submitted goal sheet.
7. Login as Admin / HR and open a quarterly check-in window.
8. Login as Employee and enter achievement updates.
9. Login as Manager and record check-in comments.
10. Login as Admin / HR or Manager and download the CSV report.

## Implemented BRD Coverage

- Employee goal creation and submission
- Thrust Area, Goal Title, Description, UoM, Target, Deadline, Weightage
- Validation: total weightage = 100%, minimum goal weightage = 10%, maximum 8 goals
- Manager approval workflow with inline target/weightage edits
- Return for rework and approved-goal locking
- Admin unlock / exception handling
- Shared departmental KPIs for multiple employees
- Shared goal title/target read-only for recipients, weightage editable
- Primary owner achievement sync for linked shared goals
- Quarterly actual achievement capture
- Status updates: Not Started, On Track, Completed
- Manager planned-vs-actual check-in module and structured comments
- Progress formulas for Min, Max, Timeline, and Zero-based goals
- Quarterly window enforcement
- Employee, Manager, Admin / HR role capabilities
- CSV achievement report
- Completion dashboard
- Audit trail
- Org hierarchy management
- Configurable escalation rules and escalation log
- Analytics dashboard
- Microsoft Entra/email/Teams configuration readiness with simulated in-app notifications

## Notes

Real Microsoft Entra SSO, email delivery, and Teams bot delivery require external tenant/webhook credentials. The project includes config-ready settings and simulated in-app notifications for hackathon demonstration.
