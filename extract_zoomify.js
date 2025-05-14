const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { parseString } = require('xml2js');
const { workingDir } = require('./track_sitemap_changes');

// Command line arguments for batch processing
// Example; default values: node extract_zoomify.js 20 0 5
const args = process.argv.slice(2);
const batchSize = parseInt(args[0]) || 20;    // Number of URLs to process in this batch, default 20 (batchSize)
const startIndex = parseInt(args[1]) || 0;     // Starting index in the sitemap, default 0 (startIndex)
const maxConcurrent = parseInt(args[2]) || 5;  // Maximum number of concurrent browser pages, default 5 (maxConcurrent)

// File paths for input/output and tracking
const initialUrlsNoXmlFile = path.join(workingDir, 'logs', 'initial_urls_noxml.txt');
const correctedUrlsFile = path.join(workingDir, 'logs', 'corrected_imageproperties_urls.txt');
const successLogFile = path.join(workingDir, 'logs', 'success_log.txt');
const failureLogFile = path.join(workingDir, 'logs', 'failure_log.txt');
const progressPath = path.join(workingDir, 'logs', 'progress.json');

// Stats tracking
let firstSuccessTime = null;
let processedCount = 0;
let processingStartTime = Date.now();

// Helper function to calculate and display processing statistics
function displayProcessingStats() {
    const currentTime = Date.now();
    const elapsedMinutes = (currentTime - processingStartTime) / 60000; // Convert to minutes
    const rate = processedCount / elapsedMinutes;
    
    console.log('\n[PROCESSING STATS]');
    if (firstSuccessTime) {
        const timeSinceFirstSuccess = (currentTime - firstSuccessTime) / 60000; // Convert to minutes
        console.log(`Time since first success: ${timeSinceFirstSuccess.toFixed(2)} minutes`);
    }
    console.log(`Total processed: ${processedCount} URLs`);
    console.log(`Current rate: ${rate.toFixed(2)} URLs/minute`);
    console.log(`Total elapsed time: ${elapsedMinutes.toFixed(2)} minutes\n`);
}

// Extract Map URLs from local_sitemap
function extractAntiqueMapUrls() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(localSitemapFile)) {
            reject(new Error(`[ERROR] Local sitemap file not found at: ${localSitemapFile}`));
            return;
        }

        const sitemapContent = fs.readFileSync(localSitemapFile, 'utf-8').trim();
        if (!sitemapContent) {
            reject(new Error(`[ERROR] Local sitemap file is empty.`));
            return;
        }

        parseString(sitemapContent, (err, result) => {
            if (err) {
                reject(new Error(`[ERROR] Failed to parse sitemap XML: ${err.message}`));
                return;
            }

            // Extract URLs containing '/P/AntiqueMap/'
            const initialUrlsNoXml = result.urlset.url
                .map(entry => entry.loc[0])
                .filter(url => url.includes('/P/AntiqueMap/'));

            if (initialUrlsNoXml.length === 0) {
                reject(new Error(`[ERROR] No Valid URLs found in local sitemap file.`));
                return;
            }

            // Write to initial_urls_noxml.txt
            fs.writeFileSync(initialUrlsNoXmlFile, initialUrlsNoXml.join('\n'), 'utf-8');
            console.log(`[INFO] Extracted ${initialUrlsNoXml.length} AntiqueMap URLs to ${initialUrlsNoXmlFile}`);

            resolve(initialUrlsNoXml);
        });
    });
}

// Validate required files and directories
async function validateEnvironment() {
    // Extract AntiqueMap URLs if needed
    if (!fs.existsSync(initialUrlsNoXmlFile)) {
        console.log('[INFO] Extracting AntiqueMap URLs from local sitemap...');
        await extractAntiqueMapUrls();
    }

    // Check if initial urls file exists and has content
    const inputContent = fs.readFileSync(initialUrlsNoXmlFile, 'utf-8').trim();
    if (!inputContent) {
        throw new Error(`[ERROR] No URLs found in ${initialUrlsNoXmlFile}`);
    }

    // Create corrected URLs file if it doesn't exist
    if (!fs.existsSync(correctedUrlsFile)) {
        fs.writeFileSync(correctedUrlsFile, '', 'utf-8');
    }

    // Return the URLs to process
    return inputContent.split('\n').map(line => line.trim()).filter(Boolean);
}

// Helper function to generate a random timeout value (10-25 seconds)
function getRandomTimeout() {
    const seconds = Math.floor(Math.random() * (25 - 10 + 1)) + 10;
    return seconds * 1000; // Convert to milliseconds
}

// Helper function for shorter timeouts (3-10 seconds)
function getShortTimeout() {
    const seconds = Math.floor(Math.random() * (10 - 3 + 1)) + 3;
    return seconds * 1000; // Convert to milliseconds
}

// Helper function to format timestamps consistently
function getTimestamp() {
    return new Date().toISOString();
}

// Helper function to log with timestamp
function logToFile(filePath, url) {
    const timestamp = getTimestamp();
    const logEntry = `${timestamp} | ${url}`;
    fs.appendFileSync(filePath, logEntry + '\n', 'utf-8');
}

// Process a single URL to extract and validate the Zoomify XML URL
async function processUrl(page, url, stats, retryCount = 0) {
    const MAX_RETRIES = 3;

    try {
        // First visit the product page to extract the Zoomify ID
        const productUrl = url; // This is already the product URL from AntiqueMap
        console.log(`[INFO] Visiting product page: ${productUrl}`);
        
        // Navigate to the product page with increased timeout
        const response = await page.goto(productUrl, { 
            waitUntil: 'networkidle0',
            timeout: getRandomTimeout()
        });

        if (!response.ok()) {
            throw new Error(`Product page returned status ${response.status()}`);
        }

        // Add a small delay to ensure page is fully loaded
        await page.waitForTimeout(2000);

        // Extract the data-zoomlink value from the specific script after the Zoomify modal comment
        const zoomlinkId = await page.evaluate(() => {
            // First find the Zoomify modal comment
            const nodes = document.evaluate(
                "//comment()[contains(., 'OUT ZOOMIFY MODAL')]",
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            
            const modalComment = nodes.singleNodeValue;
            if (!modalComment) {
                console.log('DEBUG: Zoomify modal comment not found');
                return null;
            }

            // Get the next script element after the comment
            let currentNode = modalComment.nextSibling;
            let scriptContent = '';
            while (currentNode) {
                if (currentNode.nodeName === 'SCRIPT' && 
                    currentNode.getAttribute('type') === 'text/javascript' && 
                    currentNode.getAttribute('charset') === 'utf-8') {
                    scriptContent = currentNode.textContent || '';
                    break;
                }
                currentNode = currentNode.nextSibling;
            }

            if (!scriptContent) {
                console.log('DEBUG: No matching script element found after modal comment');
                return null;
            }

            // Look for the first data-zoomlink occurrence
            const match = scriptContent.match(/data-zoomlink="([^-]+)-/);
            if (!match) {
                console.log('DEBUG: No data-zoomlink pattern found in script content');
                console.log('Script content preview:', scriptContent.substring(0, 200) + '...');
                return null;
            }

            return match[1];  // Return just the part before the dash
        });

        if (!zoomlinkId) {
            throw new Error('Failed to find data-zoomlink identifier in Zoomify modal script. Check debug output for details.');
        }

        // Extract the map ID from the product URL
        const antiqueMapIndex = url.indexOf('/P/AntiqueMap/');
        if (antiqueMapIndex === -1) {
            throw new Error('Invalid URL format - missing /P/AntiqueMap/');
        }
        const mapId = url.substring(antiqueMapIndex + 13); // Skip '/P/AntiqueMap/'
        const dashIndex = mapId.indexOf('-');
        if (dashIndex === -1) {
            throw new Error('Invalid URL format - missing dash (-) in map ID');
        }

        // Keep everything after the dash, replace only the part before it
        const mapIdSuffix = mapId.substring(dashIndex);

        // Construct the corrected ImageProperties.xml URL
        const correctedUrl = `https://www.geographicus.com/mm5/graphics/00000001/zoomify/${zoomlinkId}${mapIdSuffix}/ImageProperties.xml`;
        console.log(`[INFO] Checking Zoomify URL: ${correctedUrl}`);

        // Validate the ImageProperties.xml URL exists
        const xmlResponse = await page.goto(correctedUrl, {
            waitUntil: 'networkidle0',
            timeout: getShortTimeout()
        });

        if (!xmlResponse.ok()) {
            throw new Error(`ImageProperties.xml returned status ${xmlResponse.status()}`);
        }

        // Add a small delay to ensure XML is fully loaded
        await page.waitForTimeout(1000);

        // Check if it's valid XML content
        const content = await xmlResponse.text();
        console.log(`[DEBUG] Received content: ${content.substring(0, 200)}...`);
        
        if (!content.includes('IMAGE_PROPERTIES')) {
            throw new Error('Invalid XML content - missing IMAGE_PROPERTIES tag');
        }

        // Additional validation of XML structure
        if (!content.includes('WIDTH') || !content.includes('HEIGHT')) {
            console.log(`[DEBUG] XML missing required attributes. Content: ${content.substring(0, 200)}...`);
            throw new Error('Invalid XML content - missing required attributes');
        }

        // Log success and append to corrected URLs file
        logToFile(successLogFile, correctedUrl);
        fs.appendFileSync(correctedUrlsFile, correctedUrl + '\n');
            stats.successful++;
        processedCount++;
        if (!firstSuccessTime) {
            firstSuccessTime = Date.now();
        }
        console.log(`[SUCCESS] Validated URL: ${correctedUrl}`);
        console.log(`Original: ${url}`);
        console.log(`Modified: ${correctedUrl}`);
        displayProcessingStats();

    } catch (err) {
        console.log(`[ERROR] Processing ${url}: ${err.message}`);
        
        // Implement retry logic
        if (retryCount < MAX_RETRIES) {
            console.log(`[RETRY] Attempt ${retryCount + 1} of ${MAX_RETRIES} for ${url}`);
            // Add a longer delay between retries
            await new Promise(resolve => setTimeout(resolve, getRandomTimeout()));
            return processUrl(page, url, stats, retryCount + 1);
        }
        
        logToFile(failureLogFile, url);
        stats.failed++;
        processedCount++;
        displayProcessingStats();
    }

    // Add a short delay between requests
    await new Promise(resolve => setTimeout(resolve, getShortTimeout()));
}

// Main execution
(async () => {
    try {
        // Load previously processed URLs from logs
        const readLog = (filePath) => {
            if (!fs.existsSync(filePath)) {
                return new Set();
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            return new Set(
                content.split('\n')
                    .filter(line => line && typeof line === 'string')
                    .map(line => line.trim())
                    .filter(Boolean)
                    .map(line => {
                        const parts = line.split('|');
                        return parts.length > 1 ? parts[1].trim() : line.trim();
                    })
                    .filter(Boolean)
            );
        };

        const successSet = readLog(successLogFile);
        const failureSet = readLog(failureLogFile);

        // Read and filter input URLs
        const allUrls = await validateEnvironment();

        // Get the batch of URLs to process
        const urls = allUrls
            .filter(url => !successSet.has(url) && !failureSet.has(url))
            .slice(startIndex, startIndex + batchSize);

        if (urls.length === 0) {
            console.log('[INFO] No new URLs to process');
            return;
        }

        // Initialize browser
        const browser = await chromium.launch({ 
            headless: true,
        });

        const stats = {
            successful: 0,
            skipped: 0,
            failed: 0
        };

        // Process first URL with single concurrency
        console.log('[INFO] Processing first URL with single concurrency...');
        const firstPage = await browser.newPage();
        await processUrl(firstPage, urls[0], stats);
        await firstPage.close();
        console.log('[INFO] First URL processed, continuing with full concurrency...');

        // Create pool of browser pages for concurrent processing of remaining URLs
        const remainingUrls = urls.slice(1);
        if (remainingUrls.length > 0) {
        const pages = await Promise.all(
            Array(maxConcurrent).fill(0).map(() => browser.newPage())
        );

            // Process remaining URLs in chunks
            const chunkSize = Math.min(maxConcurrent * 2, remainingUrls.length);
            for (let i = 0; i < remainingUrls.length; i += chunkSize) {
                const chunk = remainingUrls.slice(i, i + chunkSize);
            const tasks = chunk.map((url, index) => 
                processUrl(pages[index % pages.length], url, stats)
            );

            await Promise.all(tasks);
        }

        await Promise.all(pages.map(page => page.close()));
        }

        await browser.close();

        console.log(`\n[BATCH COMPLETE] Progress saved to ${progressPath}`);
        console.log(`[SUCCESSFUL] ${stats.successful}`);
        console.log(`[SKIPPED] ${stats.skipped}`);
        console.log(`[FAILED] ${stats.failed}`);
        
        // Show command for next batch if there are more URLs
        if (startIndex + batchSize < allUrls.length) {
            console.log('\n[NEXT BATCH] Run the following command:');
            console.log(`node extract_zoomify.js ${batchSize} ${startIndex + batchSize} ${maxConcurrent}`);
        }

    } catch (error) {
        console.error('[ERROR]:', error.message);
        process.exit(1);
    }
})();

