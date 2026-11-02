# OpenStreetMap data

The regional map files in `public/data/` contain OpenStreetMap database extracts, including Beijing, Shanghai, Kyoto, Amsterdam, Lijiang Shuhe, Bibury, Manhattan, Marrakech, and Sydney.

© OpenStreetMap contributors. Available under the Open Database License (ODbL) 1.0.

- Attribution and copyright: https://www.openstreetmap.org/copyright
- License: https://opendatacommons.org/licenses/odbl/1-0/
- Providers: Overpass API and the official OpenStreetMap Map API. The exact endpoint, bbox, retrieval timestamp, and Overpass query (where applicable) are recorded in each JSON file. Map API extracts retain original node references. Relevant area relations are completed through official `relation/{id}/full.json` requests where needed, with URLs and timestamps in `metadata.completedAreas`; remaining incomplete relations are reported and omitted by the parser.

The MIT license on this project's code does not relicense the map database. Retain applicable attribution and ODbL notices when distributing the data or derived databases. PNG export embeds attribution; GLB includes attribution in metadata.
