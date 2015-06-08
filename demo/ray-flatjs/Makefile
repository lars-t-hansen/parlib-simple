.SUFFIXES: .flat_js .js

SOURCES=ray-master.flat_js ray-common.flat_js ray-worker.flat_js
TARGETS=ray-master.js ray-common.js ray-worker.js
FJSC=../../../flatjs/fjsc.js

# This is dodgy because types that are in ray-master will be visible
# within ray-worker, which is not the intent.  The correct way to do
# this is probably to compile twice, with output to two artificial
# files that merge the sources, a la TypeScript.  Fix later.

$(TARGETS): $(SOURCES)
	nodejs $(FJSC) $(SOURCES)
