/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Simple unidirectional marshaling shared-memory channel.  There can
 * be multiple senders and multiple receivers.
 *
 * This is by and large like postMessage() except that it cannot
 * transfer ArrayBuffer values (it can only copy them), and it cannot
 * send or receive SharedArrayBuffer values at all.  Also, the
 * marshaler currently does not deal with circular/shared structure
 * but that's fixable.
 */

// REQUIRE:
//   arena.js
//   marshaler.js
//   intqueue.js
//   synchronic.js

"use strict";

/*
 * Create a sender endpoint of the channel.
 *
 * "sab" is a SharedArrayBuffer, "offset" is a byte offset within that
 * buffer, "length" is the length of the region reserved as a message
 * buffer.
 *
 * All endpoints must be created before either send or receive may be
 * called on the channel.  All endpoints must be created with the same
 * values for sab, offset, and length.  The memory must be
 * zero-initialized before use and the zero values visible in all
 * threads.
 *
 * How much space will you need?  The channel transmits a stream of
 * tag+value pairs, or fieldname+tag+value triples in objects.  It
 * optimizes transmission of typed data structures (strings,
 * TypedArrays) by omitting tags when it can.  If mostly small data
 * structures are being sent then a few kilobytes should be enough to
 * allow a number of messages to sit in a queue at once.
 */
function ChannelSender(sab, offset, length) {
    this._queue = new IntQueue(sab, offset, length);
    this._marshaler = new Marshaler();
}

/*
 * Send a message on the channel, waiting for up to t milliseconds for
 * available space (undefined == indefinite wait), and then return
 * without waiting for the recipient to pick up the message.
 *
 * Returns true if the message was sent, false if space did not become
 * available.
 *
 * Throws ChannelEncodingError on encoding error.
 */
ChannelSender.prototype.send = function(msg, t) {
    try {
	var {values, newSAB} = this._marshaler.marshal([msg]);
    }
    catch (e) {
	// TODO: This could be improved by making the Marshaler throw useful errors.
	throw new ChannelEncodingError("Marshaler failed:\n" + e);
    }
    if (newSAB.length)
	throw new ChannelEncodingError("SharedArrayBuffer not supported");
    return this._queue.enqueue(values, t);
}

/*
 * Create a receiver endpoint.  See comments on the sender endpoint.
 */
function ChannelReceiver(sab, offset, length) {
    this._queue = new IntQueue(sab, offset, length);
    this._marshaler = new Marshaler();
}

/*
 * Receive a message from the channel, waiting for up to t
 * milliseconds (undefined == indefinite wait) until there is a
 * message if necessary.  Returns the message, or the noMessage value
 * if none was received.
 */
ChannelReceiver.prototype.receive = function (t, noMessage) {
    var M = this._queue.dequeue(t);
    if (M == null)
	return noMessage;
    return this._marshaler.unmarshal(M, 0, M.length)[0];
}

/*
 * Error object.
 */
function ChannelEncodingError(message) {
    this.message = message;
}
ChannelEncodingError.prototype = new Error;
