# VLAB Portal Deployment Guide

## Prerequisites
- A web server capable of serving static files
- Modern web browser with JavaScript enabled

## Deployment Options

### Option 1: Python HTTP Server (Development/Testing)
```bash
# Navigate to the project directory
cd vlab-labor-board-portal

# Start the server on port 8080
python -m http.server 8080

# Or use Python 2
python -m SimpleHTTPServer 8080

# Access at: http://localhost:8080
```

### Option 2: Node.js HTTP Server
```bash
# Install http-server globally (one-time)
npm install -g http-server

# Navigate to the project directory
cd vlab-labor-board-portal

# Start the server
http-server -p 8080

# Access at: http://localhost:8080
```

### Option 3: Apache Web Server
1. Copy all files to your Apache web root (e.g., `/var/www/html/vlab/`)
2. Ensure `.htaccess` is allowed (if needed)
3. Access via your Apache server URL

### Option 4: Nginx Web Server
1. Copy all files to your Nginx web root (e.g., `/usr/share/nginx/html/vlab/`)
2. Configure location block if needed
3. Access via your Nginx server URL

### Option 5: Amazon S3 + CloudFront
1. Create an S3 bucket
2. Enable static website hosting
3. Upload all files maintaining directory structure
4. Set appropriate permissions (public read for static assets)
5. Optionally: Configure CloudFront for CDN delivery and HTTPS

## File Structure
```
vlab-labor-board-portal/
├── index.html              # Main application page
├── app.js                  # Application logic
├── styles.css              # Custom styles
├── README.md               # Documentation
├── SECURITY.md             # Security review
├── DEPLOYMENT.md           # This file
├── sample-roster-template.csv  # Sample data
└── .gitignore             # Git ignore rules
```

## Configuration

### No Configuration Required!
The application requires no configuration. It's a pure frontend application that:
- Loads external dependencies from CDN
- Processes all data client-side
- Requires no environment variables
- Has no database connections

## Verification Steps

After deployment, verify the application works:

1. Open the application URL in your browser
2. Check that the page loads without errors (check browser console)
3. Select a date (e.g., today's date)
4. Choose a shift (Day or Night)
5. Upload the sample roster template (`sample-roster-template.csv`)
6. Click "Build Board"
7. Verify that 10 employee badges appear in the Unassigned section
8. Test drag-and-drop by moving badges between sections
9. Test presence toggle by clicking on badges (checkmark should appear/disappear)

## Browser Requirements

Minimum browser versions:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Network Requirements

The application loads two external libraries from CDN:
- Tailwind CSS from `cdn.jsdelivr.net`
- PapaParse from `cdn.jsdelivr.net`

Ensure your network allows access to these CDNs. If your environment blocks external CDNs, you can:
1. Download the libraries locally
2. Update `index.html` to reference local copies
3. Redeploy

## Performance Considerations

- The application is very lightweight (~32KB total)
- CSV parsing is done in-browser
- No database or API calls
- Typical load time: < 2 seconds on modern connections

## Monitoring

Since this is a static application:
- Monitor web server access logs
- Check browser console for JavaScript errors
- Monitor CDN availability (jsdelivr.net status)

## Troubleshooting

### Issue: Page loads but "Build Board" doesn't work
**Solution**: Check browser console for errors. Most commonly caused by CDN blocking.

### Issue: CSV upload fails
**Solution**: Verify CSV file has correct headers (see README.md for format)

### Issue: Badges don't appear
**Solution**: Check that Employee Status is "Active" in your CSV file

### Issue: Drag-and-drop doesn't work
**Solution**: Ensure you're not using file:// protocol - must use HTTP server

## Support

For issues or questions:
1. Check README.md for usage documentation
2. Review SECURITY.md for security considerations
3. Inspect browser console for error messages
4. Verify CSV file format matches template

## Updates

To update the application:
1. Pull latest code from repository
2. Replace files on server
3. No database migrations or downtime required
4. Users can refresh browser to get updates

---
**Last Updated**: October 31, 2025
