/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Simple unidirectional marshaling shared-memory channel.
//
// This is by and large like postMessage except that it cannot
// transfer ArrayBuffer values (it can only copy them), and it cannot
// send or receive SharedArrayBuffer values at all.

// REQUIRE:
//   marshaler.js

// XXXX This really is just marshaling + intqueue
// XXXX And intqueue is really just sab + synchronic

// Create one endpoint of a channel.
//
// "sab" is a SharedArrayBuffer, "offset" is a byte offset within that
// buffer, and "length" is the length of the region reserved as a
// message buffer.  "offset" and "length" should be evenly divisible
// by eight.
//
// Both endpoints must be created before either send or receive may be
// called on the channel.  Both endpoints must be created with the
// same values for sab, offset, and length.
//
// How much space do you need?  The channel transmits a stream of
// tag+value pairs, or fieldname+tag+value triples in objects.  It
// optimizes transmission of typed data structures (strings,
// TypedArrays) by omitting tags when it can.  If mostly small data
// structures are being sent then a few kilobytes should be enough to
// allow a number of messages to sit in a queue at once.

function ChannelSender(sab, offset, length) {
    if (!(sab instanceof SharedArrayBuffer) ||
	!(offset >= 0 && offset < sab.byteLength) || offset % 8 ||
	!(length >= 0 && offset + length < sab.byteLength) || length % 8)
    {
	throw new Error("Bad channel parameters");
    }
    this._sab = sab;
    this._offset = offset;
    this._length = length;

    // The sending side initializes the memory.
    // _alloc is the allocation pointer.
    // _limit is the limit of the buffer.
    // Metadata are stored at the high end.
    //
    // @len-1: head (word address)
    // @len-2: tail (word address)
    // @len-3: message count
    // @len-4: empty
    //
    // A message 

    this._iab = new Int32Array(sab, offset, length/4);
    this._alloc = 0;
    this._limit = length/4;
}

// Send a message on the channel and then return without waiting for
// the recipient.
//
// If the message cannot be sent because the queue is full then this
// invokes the onfull method and returns whatever that method returns.
//
// XXX What about invalid values?

ChannelSender.prototype.send = function(msg) {
}

ChannelSender.prototype.onfull = function () {
    throw new ChannelFullError;
}

function ChannelReceiver(sab, offset, length) {
}

// Receive a message from the channel, waiting for up to t
// milliseconds (or undefinitely if t is undefined) until there is a
// message if necessary.  If no message is received then this invokes
// the ontimeout method and returns the value of that method.

ChannelReceiver.prototype.receive = function (t) {
}

// Overridable handler that is called when receive times out.

ChannelReceiver.prototype.ontimeout = function () {
    return false;
}

function ChannelFullError() {
}
