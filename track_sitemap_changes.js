const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseString } = require('xml2js');

// File paths
const workingDir = 'C:/Users/Mai/Documents/zoomifyjs';
const CURRENT_SITEMAP = path.join(workingDir, 'local_sitemap.xml');        // Local working copy
const LATEST_SITEMAP = path.join(workingDir, 'latest_geographicus_sitemap.xml'); // Latest downloaded copy
const CHANGES_LOG = path.join(workingDir, 'logs', 'sitemap_changes.json');         // Track changes over time
const INITIAL_URLS_NOXML = path.join(workingDir, 'logs', 'initial_urls_noxml.txt');   // Initial URLs for processing

// Ensure the changes log exists with valid JSON
if (!fs.existsSync(CHANGES_LOG)) {
    fs.writeFileSync(CHANGES_LOG, JSON.stringify({ changes: [] }, null, 2));
}

// Helper function to transform sitemap URL to Zoomify URL
function transformToZoomifyUrl(sitemapUrl) {
    return sitemapUrl
        .replace('/P/AntiqueMap/', '/mm5/graphics/00000001/zoomify/') 
        + '/ImageProperties.xml';
}

// Helper function to filter out '_d' URLs, these urls both include the same image.
function filterDuplicateUrls(urls) {
    const filteredUrls = new Set();
    
    for (const url of urls) {
        // If URL ends with '_d' and its base version exists, skip it
        if (url.endsWith('_d')) {
            const baseUrl = url.slice(0, -2);
            if (urls.has(baseUrl)) {
                continue;
            }
        }
        filteredUrls.add(url);
    }
    
    return filteredUrls;
}

// Helper function to extract URLs from sitemap XML
function extractUrls(xmlContent) {
    return new Promise((resolve, reject) => {
        parseString(xmlContent, (err, result) => {
            if (err) {
                reject(err);
                return;
            }
            
            const urls = new Set(
                result.urlset.url
                    .map(entry => entry.loc[0])
                    .filter(url => url.includes('/P/AntiqueMap/'))
            );
            
            // Filter out '_d' URLs
            const filteredUrls = filterDuplicateUrls(urls);
            resolve(filteredUrls);
        });
    });
}

// Helper function to download the latest sitemap
function downloadSitemap() {
    return new Promise((resolve, reject) => {
        https.get('https://www.geographicus.com/sitemap.xml', (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to download sitemap: ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// Helper function to read local sitemap
function readLocalSitemap(filepath) {
    return fs.existsSync(filepath) 
        ? fs.readFileSync(filepath, 'utf-8')
        : '';
}

// Helper function to find differences between two sets
function findDifferences(oldUrls, newUrls) {
    const added = [...newUrls].filter(url => !oldUrls.has(url));
    const removed = [...oldUrls].filter(url => !newUrls.has(url));
    return { added, removed };
}

// Main function to check for sitemap changes
async function checkSitemapChanges() {
    try {
        console.log('[INFO] Downloading latest sitemap...');
        const latestXml = await downloadSitemap();
        
        // Save the latest sitemap
        fs.writeFileSync(LATEST_SITEMAP, latestXml);
        
        // Extract URLs from both sitemaps
        const latestUrls = await extractUrls(latestXml);
        console.log(`[INFO] Found ${latestUrls.size} URLs in latest sitemap`);

        const localXml = readLocalSitemap(CURRENT_SITEMAP);
        const localUrls = localXml ? await extractUrls(localXml) : new Set();
        console.log(`[INFO] Found ${localUrls.size} URLs in local sitemap`);

        // Find differences
        const { added, removed } = findDifferences(localUrls, latestUrls);

        // Generate/Update initial_urls_noxml.txt with all current URLs
        const allZoomifyUrls = [...latestUrls].map(url => url).join('\n');
        fs.writeFileSync(INITIAL_URLS_NOXML, allZoomifyUrls);
        console.log(`[INFO] Updated ${INITIAL_URLS_NOXML} with ${latestUrls.size} URLs`);

        // If there are changes, log them
        if (added.length > 0 || removed.length > 0) {
            const changes = JSON.parse(fs.readFileSync(CHANGES_LOG, 'utf-8'));
            changes.changes.push({
                date: new Date().toISOString(),
                added: added,
                removed: removed
            });
            
            fs.writeFileSync(CHANGES_LOG, JSON.stringify(changes, null, 2));
            
            console.log('\n[CHANGES DETECTED]');
            console.log(`[ADDED] ${added.length} URLs`);
            console.log(`[REMOVED] ${removed.length} URLs`);

            // If this is the first run or changes were found, update the local copy
            if (!localXml || added.length > 0 || removed.length > 0) {
                fs.writeFileSync(CURRENT_SITEMAP, latestXml);
                console.log('[INFO] Updated local sitemap');
            }
        } else {
            console.log('\n[INFO] No changes detected');
        }

        return {
            latestUrls,
            changes: { added, removed }
        };

    } catch (error) {
        console.error('[ERROR]:', error.message);
        throw error;
    }
}

// If running directly, show historical changes
if (require.main === module) {
    console.log('[INFO] Checking for sitemap changes...');
    checkSitemapChanges().then(() => {
        // Print summary of all historical changes
        const allChanges = JSON.parse(fs.readFileSync(CHANGES_LOG, 'utf-8'));
        console.log('\n[HISTORY] Changes Summary:');
        allChanges.changes.forEach(change => {
            console.log(`\n${new Date(change.date).toLocaleDateString()}:`);
            console.log(`[ADDED] ${change.added.length} URLs`);
            console.log(`[REMOVED] ${change.removed.length} URLs`);
        });
    });
}

module.exports = {
    checkSitemapChanges,
    extractUrls,
    CURRENT_SITEMAP,
    LATEST_SITEMAP,
    CHANGES_LOG,
    INITIAL_URLS_NOXML,
    workingDir
}; 