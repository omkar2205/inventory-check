# Event Distribution

Mobile-first employee food/drink distribution tool for rush-hour event use.

## What v1 does

- Search employees by name, Employee Code, Brand, Team or L1 Manager.
- Filter quickly by Brand, Team and Manager.
- Show whether an employee is still available or has already collected.
- Select one employee or several employees for proxy/bulk collection.
- Save who collected a multi-person order.
- Record every successful handover with a timestamp.
- Prevent duplicate handovers, including simultaneous attempts from multiple counters.
- Show a live distributed / total counter.
- Keep the employee master sheet unchanged; transactions go to a separate `Distribution Log` sheet.

## Files

- `index.html` – mobile interface
- `styles.css` – responsive rush-friendly styling
- `app.js` – search, filters, selection and handover flow
- `Code.gs` – Google Apps Script backend connected to the Employee List spreadsheet

## One-time backend setup

1. Open [Google Apps Script](https://script.google.com/) and create a new project.
2. Replace the default code with the contents of `Code.gs`.
3. Save the project.
4. Choose **Deploy → New deployment → Web app**.
5. Execute as: **Me**.
6. Choose the access level appropriate for the event devices. For a GitHub Pages frontend, the web app must be reachable by those devices without an interactive Apps Script authorization screen.
7. Deploy and copy the URL ending in `/exec`.
8. Open `app.js` and paste that URL into `CONFIG.API_URL`.

The first successful backend call automatically creates a `Distribution Log` tab in the same spreadsheet.

## GitHub Pages

After `CONFIG.API_URL` is set, enable GitHub Pages for the repository using the `main` branch and root folder.

## Employee sheet expected columns

The backend currently reads `Sheet1` and detects these columns by header name:

- Employee Code
- Employee Name
- Brand
- Sub-Sub Service Line
- L1 Manager

The backend uses Employee Code as the unique identifier even when the operator finds the person by another field.

## Distribution Log

The backend creates these columns automatically:

- Timestamp
- Employee Code
- Employee Name
- Brand
- Team
- L1 Manager
- Collected By Code
- Collected By Name
- Transaction ID

A batch/proxy collection gets one shared Transaction ID so the group can be traced later.
