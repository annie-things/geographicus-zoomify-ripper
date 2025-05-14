const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Parse command line arguments
const args = process.argv.slice(2);
const batchSize = parseInt(args[0]) || 10;     // Default batch size of 10 if not specified
const startIndex = parseInt(args[1]) || 0;      // Start index, defaults to 0
const maxConcurrent = parseInt(args[2]) || 3;   // Maximum concurrent downloads, default 3

// Settings
const workingDir = 'C:/Users/Mai/Documents/zoomifyjs';  // Updated working directory
const inputFile = path.join(workingDir, 'logs', 'corrected_imageproperties_urls.txt');  // Updated input file
const dezoomifyExecutable = path.join(workingDir, 'dezoomify-rs.exe');
const successLogFile = path.join(workingDir, 'logs', 'dezoomify_success.txt');  // Renamed to avoid confusion
const failureLogFile = path.join(workingDir, 'logs', 'dezoomify_failure.txt');  // Renamed to avoid confusion
const detailedFailureLogFile = path.join(workingDir, 'logs', 'dezoomify_failure_details.json');  // New detailed failure log
const progressFile = path.join(workingDir, 'logs', 'dezoomify_progress.json');  // Renamed to avoid confusion
const outputDir = path.join(workingDir, 'finished_zoomify_downloads');
const tileCacheDir = path.join(workingDir, 'Tilecache');
const extractSuccessFile = path.join(workingDir, 'logs', 'success_log.txt');  // Add reference to extract_zoomify's success log

// Ensure output directories exist
[outputDir, tileCacheDir, path.join(workingDir, 'logs')].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Helper to sanitize filenames
function sanitizeFilename(url) {
    let base = url.replace('https://www.geographicus.com/mm5/graphics/00000001/zoomify/', '');
    base = base.replace('/ImageProperties.xml', '');
    return base.replace(/[^a-z0-9_\-]/gi, '_');
}

// Load previous logs
const readLog = (filePath) => {
    return fs.existsSync(filePath)
        ? new Set(fs.readFileSync(filePath, 'utf-8')
            .split('\n')
            .map(line => {
                // Handle timestamped log entries
                const parts = line.split('|');
                return parts.length > 1 ? parts[1].trim() : line.trim();
            })
            .filter(Boolean))
        : new Set();
};

// Read both run_dezoomify success log and extract_zoomify success log
const dezoomifySuccessSet = readLog(successLogFile);
const extractSuccessSet = readLog(extractSuccessFile);
const failureSet = readLog(failureLogFile);

// Read input URLs
if (!fs.existsSync(inputFile)) {
    console.error(`❌ Input file "${inputFile}" not found.`);
    process.exit(1);
}

const allUrls = fs.readFileSync(inputFile, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

// Only skip URLs that have been successfully processed by both scripts
// or have failed in run_dezoomify
const urls = allUrls.filter(url => {
    const processedByBoth = dezoomifySuccessSet.has(url) && extractSuccessSet.has(url);
    const hasFailed = failureSet.has(url);
    return !processedByBoth && !hasFailed;
});

let successCount = dezoomifySuccessSet.size;
let failCount = failureSet.size;
let current = startIndex;
let activeDownloads = 0;

// Calculate batch end index
const endIndex = Math.min(startIndex + batchSize, urls.length);

// Helper function to get timestamp
function getTimestamp() {
    return new Date().toISOString();
}

function logToFile(filePath, content) {
    const timestamp = getTimestamp();
    fs.appendFileSync(filePath, `${timestamp} | ${content}\n`);
}

// Enhanced logging for failures
function logFailure(url, error, type = 'download') {
    const timestamp = getTimestamp();
    
    // Log to simple failure log
    logToFile(failureLogFile, url);
    
    // Load existing detailed failures
    let detailedFailures = {};
    if (fs.existsSync(detailedFailureLogFile)) {
        try {
            detailedFailures = JSON.parse(fs.readFileSync(detailedFailureLogFile, 'utf-8'));
        } catch (e) {
            console.warn('Warning: Could not parse detailed failure log, starting fresh');
        }
    }
    
    // Add new failure entry
    detailedFailures[url] = {
        timestamp,
        type,
        error: error.message || error.toString(),
        stderr: error.stderr || null,
        attempts: (detailedFailures[url]?.attempts || 0) + 1,
        lastAttempt: timestamp
    };
    
    // Save detailed failures
    fs.writeFileSync(detailedFailureLogFile, JSON.stringify(detailedFailures, null, 2));
}

function saveProgress() {
    // Load detailed failures to get statistics
    let failureDetails = {};
    if (fs.existsSync(detailedFailureLogFile)) {
        try {
            failureDetails = JSON.parse(fs.readFileSync(detailedFailureLogFile, 'utf-8'));
        } catch (e) {
            console.warn('Warning: Could not read detailed failure log for statistics');
        }
    }

    // Calculate failure statistics
    const failureStats = {
        total: Object.keys(failureDetails).length,
        byType: Object.values(failureDetails).reduce((acc, curr) => {
            acc[curr.type] = (acc[curr.type] || 0) + 1;
            return acc;
        }, {}),
        multipleAttempts: Object.values(failureDetails).filter(f => f.attempts > 1).length
    };

    const progress = {
        lastProcessedIndex: current,
        totalUrls: urls.length,
        successCount,
        failCount,
        lastUpdate: getTimestamp(),
        totalProcessed: {
            dezoomifySuccess: dezoomifySuccessSet.size,
            extractSuccess: extractSuccessSet.size,
            completedBoth: [...dezoomifySuccessSet].filter(url => extractSuccessSet.has(url)).length,
            failed: failureStats
        },
        activeDownloads
    };
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

// Process a single URL
async function processUrl(url) {
    const filename = sanitizeFilename(url);
    const tempOutputPath = path.join(workingDir, `${filename}.jpg`);
    const finalOutputPath = path.join(outputDir, `${filename}.jpg`);
    const command = `"${dezoomifyExecutable}" -l -c "${tileCacheDir}" "${url}" "${tempOutputPath}"`;

    console.log(`\n▶️ [${current}/${endIndex}] Processing: ${url}`);
    
    try {
        await execAsync(command);
        try {
            fs.renameSync(tempOutputPath, finalOutputPath);
            console.log(`✅ Success: ${finalOutputPath}`);
            logToFile(successLogFile, url);
            successCount++;
        } catch (moveErr) {
            console.error(`⚠️ File move failed: ${moveErr.message}`);
            logFailure(url, moveErr, 'move_failure');
            failCount++;
        }
    } catch (error) {
        console.error(`❌ Failed: ${url}\n   ${error.stderr || error.message}`);
        logFailure(url, error, 'download_failure');
        failCount++;
    }
    
    activeDownloads--;
    saveProgress();
}

// Main processing function with concurrency
async function processUrls() {
    console.log(`📥 Starting batch processing from index ${startIndex} to ${endIndex-1}`);
    console.log(`📊 Total URLs remaining: ${urls.length - startIndex}`);
    console.log(`🔄 Maximum concurrent downloads: ${maxConcurrent}`);

    // Process URLs in concurrent batches
    while (current < endIndex) {
        // Start new downloads if under concurrency limit
        while (activeDownloads < maxConcurrent && current < endIndex) {
            const url = urls[current++];
            if (url) {
                activeDownloads++;
                processUrl(url).catch(error => {
                    console.error(`❌ Unexpected error processing ${url}:`, error);
                    activeDownloads--;
                });
            }
        }

        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Wait for remaining downloads to complete
    while (activeDownloads > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n✅ Batch complete.`);
    console.log(`   ✔️ Total successful: ${successCount}`);
    console.log(`   ❌ Total failed: ${failCount}`);
    console.log(`   📊 Progress: ${current}/${urls.length} URLs processed`);
    
    if (current < urls.length) {
        console.log(`\n💡 To continue processing, run:`);
        console.log(`   node run_dezoomify.js ${batchSize} ${current} ${maxConcurrent}`);
    }
    
    saveProgress();
}

// Start processing
processUrls().catch(error => {
    console.error('[ERROR]:', error.message);
    process.exit(1);
});
