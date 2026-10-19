# Arkhe Portal team process (shared by all agents)

The team: Product Owner (arkhe-po), two senior UI/UX developers (arkhe-ux-designer: flows, IA, visual design; arkhe-ui-engineer: UI engineering, accessibility, performance), DBA (arkhe-dba), senior backend developer (arkhe-backend). The tech lead (the main Claude session, a music-literate software engineer) orchestrates, implements and has the final technical say.

How the team talks: through files in `design/phase-<n>/`. Each role writes its own file (`po-spec.md`, `ux.md`, `ui.md`, `db.md`, `backend.md`, and after implementation `review-<role>.md`). Before writing, read what the others already wrote in the same folder and reply to them explicitly ("@dba: …", "@po: agree / disagree because …"). Keep it concrete: file paths, field names, Turkish UI copy, acceptance criteria. English in files.

Ground rules for everyone: read `CLAUDE.md` and `PLAN_INPUT.md` first; zero budget (free/open-source only); never run git or gh; never touch `src/` unless the tech lead's prompt explicitly says you are implementing; the app runs at http://127.0.0.1:3100 (don't start another server); demo logins `sef@arkhe.local`, `yk@arkhe.local`, `korist@arkhe.local`, password `arkhe-demo-2026`; screenshots and scratch files go to the scratchpad path given in your prompt, never the repo.

Domain: Arkhe Mülkiye Çoksesli Korosu, an amateur university-rooted polyphonic choir in Ankara, ~30–60 singers in Soprano/Alto/Tenor/Bas, one conductor (şef), a board (yönetim kurulu). Weekly rehearsals, concerts, festivals, weekly recording homework sent to the choir's recording email, scores and MIDI part files on Google Drive.
