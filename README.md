# vlab-labor-board-portal
Next-gen VLAB Labor Board portal with new design specs, interactive headcount tools, and compact operational UI. Implements requirements from October 2025.

## Features

### Multi-Site Assignment Management
- Switch between sites (YDD2, YDD4, YHM2) with preserved assignments
- Cross-site assignment prevention
- Site-specific analytics and tracking

### CSV File Upload Support
- **Roster**: Main employee roster with Employee ID, Name, Status, Shift Pattern
- **Swaps**: Employee shift swaps (IN/OUT directions)
- **VET/VTO**: Voluntary Extra Time and Voluntary Time Off
- **Labor Share**: Inter-site labor sharing agreements
- **Missing Associates**: Supplemental employee data for associates not in main roster

### Upload Feature
Upload a CSV/TSV file with additional associates to supplement the main roster. The system will:
- Auto-detect tab-separated or comma-separated format
- Merge uploaded associates with the main roster
- Prevent duplicate entries (checks by Employee ID)
- Apply same site filtering and shift validation
- Add to unassigned pool for assignment

Expected file format (tab-separated or comma-separated):
```
Employee ID	User ID	Employee Name	Badge Barcode ID	Department ID	Employment Start Date	Employment Type	Employee Status	Manager Name	Management Area ID	Shift Pattern
110888249	qruchikr	Ruchika,Ruchika	13966332	1299020	Wed Sep 22 00:00:00 UTC 2021	AMZN	Active	Bhatt,Devashish	3	DA6C0700
```

### Analytics System
- Real-time assignment tracking with site visibility
- Current assignment status (prevents duplicate tracking)
- Session-based analytics with date/time synchronization

## Quick Start
1. Serve the folder over HTTP: `python -m http.server 8080`
2. Open `http://localhost:8080` in your browser
3. Upload CSV files and select date/shift/site
4. Drag and drop associates between process areas
