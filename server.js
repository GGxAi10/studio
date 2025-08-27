const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.static('public')); // Serve static files from 'public' directory

// Setup multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath);
        }
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, uuidv4() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

app.post('/generate-apk', upload.fields([{ name: 'zipFile', maxCount: 1 }, { name: 'iconFile', maxCount: 1 }]), async (req, res) => {
    const { type, appName } = req.body;
    const zipFile = req.files['zipFile'] ? req.files['zipFile'][0] : null;
    const iconFile = req.files['iconFile'] ? req.files['iconFile'][0] : null;
    const htmlCode = req.body.htmlCode;
    const url = req.body.url;

    const projectId = uuidv4();
    const projectPath = path.join(__dirname, 'cordova_projects', projectId);

    try {
        // Create Cordova project
        exec(`cordova create ${projectPath} com.example.${projectId.replace(/-/g, '')} "${appName}"`, async (error, stdout, stderr) => {
            if (error) {
                console.error(`cordova create error: ${error}`);
                return res.status(500).json({ success: false, message: 'Failed to create Cordova project.', error: stderr });
            }
            console.log(`cordova create stdout: ${stdout}`);

            const wwwPath = path.join(projectPath, 'www');
            const resourcesPath = path.join(projectPath, 'res');

            // Clean www directory
            fs.readdirSync(wwwPath).forEach(file => {
                const curPath = path.join(wwwPath, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    fs.rmSync(curPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(curPath);
                }
            });

            // Copy content based on input type
            if (type === 'html_code' && htmlCode) {
                fs.writeFileSync(path.join(wwwPath, 'index.html'), htmlCode);
            } else if (type === 'url' && url) {
                // This approach is for a basic webview app
                // For more robust webview, consider plugins like cordova-plugin-inappbrowser
                fs.writeFileSync(path.join(wwwPath, 'index.html'), `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: gap: https://ssl.gstatic.com 'unsafe-eval'; style-src 'self' 'unsafe-inline'; media-src *; img-src 'self' data: content:;">
                        <meta name="format-detection" content="telephone=no">
                        <meta name="msapplication-tap-highlight" content="no">
                        <meta name="viewport" content="initial-scale=1, width=device-width, viewport-fit=cover">
                        <title>${appName}</title>
                        <style>
                            body { margin: 0; padding: 0; overflow: hidden; }
                            iframe { width: 100vw; height: 100vh; border: none; }
                        </style>
                    </head>
                    <body>
                        <iframe src="${url}"></iframe>
                        <script src="cordova.js"></script>
                    </body>
                    </html>
                `);
            } else if (type === 'file' && zipFile) {
                try {
                    const zip = new AdmZip(zipFile.path);
                    zip.extractAllTo(wwwPath, true);
                } catch (zipError) {
                    console.error(`Unzip error: ${zipError}`);
                     // Clean up uploaded file
                     if (zipFile && fs.existsSync(zipFile.path)) {
                        fs.unlinkSync(zipFile.path);
                    }
                    // Clean up project directory
                    if (fs.existsSync(projectPath)) {
                        fs.rmSync(projectPath, { recursive: true, force: true });
                    }
                    return res.status(500).json({ success: false, message: 'Failed to extract zip file.' });
                }
            } else {
                 // Clean up uploaded file
                 if (zipFile && fs.existsSync(zipFile.path)) {
                    fs.unlinkSync(zipFile.path);
                }
                if (iconFile && fs.existsSync(iconFile.path)) {
                    fs.unlinkSync(iconFile.path);
                }
                // Clean up project directory
                if (fs.existsSync(projectPath)) {
                    fs.rmSync(projectPath, { recursive: true, force: true });
                }
                return res.status(400).json({ success: false, message: 'Invalid input type or missing data.' });
            }

            // Copy app icon if provided
            if (iconFile) {
                const iconFileName = 'icon.png'; // Standard icon name in Cordova
                const destinationIconPath = path.join(resourcesPath, 'icon', 'android', iconFileName); // Example path for Android
                 // Ensure the destination directory exists
                 const iconDir = path.dirname(destinationIconPath);
                 if (!fs.existsSync(iconDir)) {
                     fs.mkdirSync(iconDir, { recursive: true });
                 }
                fs.copyFileSync(iconFile.path, destinationIconPath);
                // Update config.xml with icon path (basic example)
                const configXmlPath = path.join(projectPath, 'config.xml');
                if (fs.existsSync(configXmlPath)) {
                    let configXmlContent = fs.readFileSync(configXmlPath, 'utf-8');
                    // Remove existing icon tags
                    configXmlContent = configXmlContent.replace(/<icon\s+src="[^"]+"\s*\/?>/g, '');
                     configXmlContent = configXmlContent.replace(/<icon\s+density="[^"]+"\s+src="[^"]+"\s*\/?>/g, '');
                    // Add the new icon tag (adjust path as needed for different resolutions)
                    configXmlContent = configXmlContent.replace('</widget>', `    <icon src="res/icon/android/${iconFileName}" />\n</widget>`);
                    fs.writeFileSync(configXmlPath, configXmlContent);
                }
            }

            // Add Android platform
            exec(`cd ${projectPath} && cordova platform add android --save`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`cordova platform add android error: ${error}`);
                     // Clean up uploaded files
                     if (zipFile && fs.existsSync(zipFile.path)) {
                        fs.unlinkSync(zipFile.path);
                    }
                    if (iconFile && fs.existsSync(iconFile.path)) {
                        fs.unlinkSync(iconFile.path);
                    }
                    // Clean up project directory
                    if (fs.existsSync(projectPath)) {
                        fs.rmSync(projectPath, { recursive: true, force: true });
                    }
                    return res.status(500).json({ success: false, message: 'Failed to add Android platform.', error: stderr });
                }
                console.log(`cordova platform add android stdout: ${stdout}`);

                // Build the Android project
                exec(`cd ${projectPath} && cordova build android --release`, (error, stdout, stderr) => {
                    // Clean up uploaded files regardless of build success
                    if (zipFile && fs.existsSync(zipFile.path)) {
                        fs.unlinkSync(zipFile.path);
                    }
                    if (iconFile && fs.existsSync(iconFile.path)) {
                        fs.unlinkSync(iconFile.path);
                    }

                    if (error) {
                        console.error(`cordova build android error: ${error}`);
                         // Clean up project directory on build failure
                        if (fs.existsSync(projectPath)) {
                            fs.rmSync(projectPath, { recursive: true, force: true });
                        }
                        return res.status(500).json({ success: false, message: 'Failed to build Android app.', error: stderr });
                    }
                    console.log(`cordova build android stdout: ${stdout}`);

                    const apkPath = path.join(projectPath, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
                    const finalApkPath = path.join(__dirname, 'public', `${appName.replace(/\s+/g, '_')}-${projectId}.apk`);

                    if (fs.existsSync(apkPath)) {
                        // In a real application, you would sign this APK here
                        // For this example, we'll just rename the unsigned one
                        fs.copyFileSync(apkPath, finalApkPath);

                        // Clean up the temporary Cordova project directory after sending the file
                        // Delaying cleanup slightly to ensure file is accessible for download
                        setTimeout(() => {
                            if (fs.existsSync(projectPath)) {
                                fs.rmSync(projectPath, { recursive: true, force: true });
                                console.log(`Cleaned up project directory: ${projectPath}`);
                            }
                        }, 5000); // Clean up after 5 seconds

                        res.json({ success: true, downloadUrl: `/${appName.replace(/\s+/g, '_')}-${projectId}.apk` });

                    } else {
                         // Clean up project directory if APK not found
                         if (fs.existsSync(projectPath)) {
                            fs.rmSync(projectPath, { recursive: true, force: true });
                        }
                        res.status(500).json({ success: false, message: 'APK build failed or APK file not found.' });
                    }
                });
            });
        });

    } catch (error) {
        console.error('Server error:', error);
         // Clean up uploaded files on general error
         if (zipFile && fs.existsSync(zipFile.path)) {
            fs.unlinkSync(zipFile.path);
        }
        if (iconFile && fs.existsSync(iconFile.path)) {
            fs.unlinkSync(iconFile.path);
        }
         // Clean up project directory on general error
         if (fs.existsSync(projectPath)) {
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
        res.status(500).json({ success: false, message: 'An internal server error occurred.' });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
