// If the message is an array whose first element is a string that
// matches "tag" then consume the message and invoke fn on its data.

function dispatchMessage(target, tag, fn) {
    if (typeof tag != "string")
	throw new Error("Tag to dispatchMessage must be string: " + tag);

    target.addEventListener("message", function (ev) {
	if (Array.isArray(ev.data) && ev.data.length >= 1 && ev.data[0] === tag) {
	    ev.stopImmediatePropagation();
	    fn(ev.data);
	}
    });
}
