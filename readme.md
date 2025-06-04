## Requirements
+ Node.js
+ playwright 1.52.0
+ xml2js 0.6.2
### In the working directory (same folder as extract_zoomify.js, run_dezoomify.js, etc.)
- [Dezoomify-rs](https://github.com/lovasoa/dezoomify-rs): `dezoomify-rs.exe`
## Running
+ `node SCRIPTNAME.js`
+ `track_sitemap_changes.js` should produce a local copy of the current sitemap and when run will download the latest sitemap, parse the relevant urls, and track any additions/removals in sitemap_changes.json; raw urls should go to inital_urls_noxml.txt
+ `extract_zoomify` queries html on given urls in order to generate an ImageProperties.xml link that is valid (simply deriving from the base URL will not, as it is case sensitive)
+ `run_dezoomify` runs dezoomify-rs.exe with concurrent DLs, batching, and logging; File names will be the map name as written in the url by default.

For extract_zoomify & run_dezoomify you can specify the following args when running: batch size, index location (line # in the list of URLs to be processed where the script will begin), and concurrent DL threads; ie.'node run_dezoomify.js 50 0 5' will run a batch of 50 urls from the start of the file w/ 5 concurrent threads.

////////////////////////////////////////

Released under GPLv3 in keeping with dezoomify-rs.
