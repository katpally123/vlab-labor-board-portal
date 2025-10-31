# VLAB Labor Board Portal

Next-gen Virtual Labor Assignment Board (VLAB) portal with new design specs, interactive headcount tools, and compact operational UI. Implements requirements from October 2025.

## Overview

A single-page web application for Amazon fulfillment center operations managers to manage labor assignments across different process paths. Built with pure HTML/CSS/JavaScript - no backend required.

## Features

- **CSV Data Import** - Upload Roster, Swaps, VET/VTO, and LaborShare files
- **Interactive Badge System** - Drag-and-drop employee badges between process paths
- **Smart Shift Filtering** - Automatic shift type detection (FHD, BHD, FHN, BHN) based on day of week
- **Site Classification** - Support for YHM2 and YDD2 sites with department-based filtering
- **Real-time Headcount** - Planned HC and Actual HC tracking with presence indicators
- **Volume Per Head Calculator** - Automatic VPH calculation
- **Export Functionality** - Export shift summary data to JSON

## Quick Start

1. **Serve the application** using any static HTTP server:
   ```bash
   # Using Python
   python -m http.server 8080
   
   # Or using Node.js
   npx http-server -p 8080
   ```

2. **Open your browser** and navigate to `http://localhost:8080`

3. **Upload your data**:
   - Select a date and shift (Day/Night)
   - Choose your site (YHM2 or YDD2)
   - Upload your Roster CSV file (required)
   - Optionally upload Swaps, VET/VTO, and LaborShare files
   - Click "Build Board"

4. **Manage assignments**:
   - Click badges to mark present/absent (green checkmark appears)
   - Drag badges from the Unassigned sidebar to process tiles
   - Drag badges between tiles to reassign

## CSV File Format

### Roster File (Required)
Must include these columns:
- `Employee Name` or `Name`
- `Employee ID` or `ID`
- `Employee Status` or `Status` (must be "Active")
- `Shift Pattern`, `ShiftCode`, `Shift Code`, or `Shift` (e.g., DA, DB, NA, NB)

Optional for site classification:
- `Department ID` or `DepartmentID` or `Dept ID`
- `Management Area ID` or `ManagementAreaID`

### Other Files (Optional)
- **Swaps**: Must have `Direction` column (IN/OUT)
- **VET/VTO**: Must have `Type` (VET/VTO) and `Accepted`/`Status` columns
- **LaborShare**: Must have `Direction` column (IN/OUT)

## Shift Codes

- **Day Shift**: DA, DB, DC, DL, DN, DH
- **Night Shift**: NA, NB, NC, NL, NN, NH

Each code has its own color coding in the UI for easy identification.

## Process Paths

The board includes 15 process paths:
- Unassigned, CB, IB WS, Line Loaders, Trickle
- Destination Markers, IDRT, Pallet Build, Each to Sort, Dock WS
- E2S WS, Tote Pallet Build, Tote WS, SAP, AO/5S

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Styling**: Tailwind CSS + Custom CSS
- **CSV Parsing**: PapaParse library
- **Drag & Drop**: Native HTML5 Drag and Drop API

## Browser Requirements

- Modern browser with HTML5 support (Chrome, Firefox, Safari, Edge)
- JavaScript enabled
- Must be served via HTTP/HTTPS (file:// protocol won't work due to security restrictions)

## Development

No build process required. Simply edit the files and refresh your browser:
- `index.html` - Page structure and form layout
- `app.js` - All application logic
- `styles.css` - Custom styling and badge colors

## License

© 2025 Amazon. Internal use only.
