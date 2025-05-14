## Requirements
+ Node.js
+ playwright: ^1.52.0
+ xml2js: ^0.6.2
### Place in the working directory (same folder as extract_zoomify.js, run_dezoomify.js, etc.)
- Dezoomify-rs: Ensure the `dezoomify-rs.exe` executable is present in the project directory.
## Running
+ 'node SCRIPTNAME.js'
+ 'track_sitemap_changes' should produce a local copy of the current sitemap and when run will download the latest sitemap, parse the relevant urls, and track any additions/removals in sitemap_changes.json; raw urls should go to inital_urls_noxml.txt
+ 'extract_zoomify' queries html elements on the given urls in order to generate an ImageProperties.xml link that is valid (simply scraping will not, as it is case sensitive)
+ 'run_dezoomify' runs dezoomify-rs.exe with concurrent DLs, batching, and logging of download success/fail; File names will be the map name as written in the url by default.

For extract_zoomify & run_dezoomify you can specify the following args when running: batch size, index location (line # in the list of URLs to be processed where the script will begin), and concurrent DL threads; ie.'node run_dezoomify.js 50 0 5' will run a batch of 50 urls from the start of the file w/ 5 concurrent threads.
