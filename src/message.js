function dispatchMessage(target, tag, fn) {
    target.addEventListener("message",
			    function (ev) {
				if (Array.isArray(ev.data) && ev.data.length >= 1 && ev.data[0] == tag) {
				    ev.stopImmediatePropagation();
				    fn(ev.data);
				}
			    });
}
