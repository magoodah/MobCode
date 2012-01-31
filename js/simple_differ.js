// Copyright 2010 Google Inc. All Rights Reserved.
/**
 * @fileoverview Converts a series of inserts/deletes against a base string
 *     (some of which may be overlapping) into a simplified diff (in which
 *     operations never overlap and are applied from end to beginning).
 *     This does not take the base string itself as an parameter, so its
 *     performance will not be directly affected by the size of the input.
 *
 * @author bloom@google.com (David Bloom)
 */

/**
 * Creates a new simple differ.
 * @constructor
 */
mobwrite.SimpleDiffer = function() {
  this.chunks_ = [
    {
      start: 0,
      length: Infinity,
      type: 'copy'
    }
  ];
};


/**
 * An internal representation of how to construct the new text from an empty
 * document. This is made up of two types of chunks: "copy", which copies
 * text from the original document, and "insert", which inserts a string. We can
 * later figure out deletions from the original document by measuring the gap
 * between "copy" chunks, thus producing the simple diff.
 * @type {Array.<Object>} The chunks of the mutated document.
 * @private
 */
mobwrite.SimpleDiffer.prototype.chunks_;


/**
 * Pushes an insertion onto the sequence of mutations.
 * @param {number} index The character index to insert at.
 * @param {string} text The inserted text.
 */
mobwrite.SimpleDiffer.prototype.applyInsert = function(index, text) {
  var x = this.findChunk_(index);
  var chunkIndex = x[0], splitOffset = x[1];
  this.splitChunk_(chunkIndex, splitOffset);
  var insertAtIndex = chunkIndex + 1;
  var newChunk = {
    type: 'insert',
    text: text,
    length: text.length
  };
  this.chunks_.splice(insertAtIndex, 0, newChunk);
};


/**
 * Pushes a deletion onto the sequence of mutations.
 * @param startIndex
 * @param endIndex
 */
mobwrite.SimpleDiffer.prototype.applyDelete = function(startIndex, endIndex) {
  if (startIndex == endIndex) {
    return;
  }
  var start = this.findChunk_(startIndex);
  var startChunkIndex = start[0],
      startOffset = start[1];
  this.splitChunk_(startChunkIndex, startOffset);
  var deleteStartIndex = startChunkIndex + 1;
  var end = this.findChunk_(endIndex);
  var endChunkIndex = end[0],
      endOffset = end[1];
  this.splitChunk_(endChunkIndex, endOffset);
  var deleteEndIndex = endChunkIndex + 1;
  this.chunks_.splice(deleteStartIndex, deleteEndIndex - deleteStartIndex);
};


/**
 * Splits a chunk into to adjacent chunks, at a point within the chunk's text.
 * @param {number} chunkIndex The index of the chunk to split in this.chunks_.
 * @param {number} splitAt The text offset to split the chunk at.
 * @private
 */
mobwrite.SimpleDiffer.prototype.splitChunk_ = function(chunkIndex, splitAt) {
  var chunk = this.chunks_[chunkIndex];
  var newChunk = {
    length: chunk.length - splitAt,
    type: chunk.type
  };
  chunk.length = splitAt;
  if (chunk.type == 'insert') {
    newChunk.text = chunk.text.substr(splitAt);
    chunk.text = chunk.text.substr(0, splitAt);
  } else if (chunk.type == 'copy') {
    newChunk.start = chunk.start + splitAt;
  }
  this.chunks_.splice(chunkIndex + 1, 0, newChunk);
};


/**
 * Finds the chunk at a character index in the text with all mutations so far
 * applied.
 * @param {number} targetCharIndex The character index to find the chunk for.
 * @return {Array} A tuple of the index of the chunk in chunks_, and the
 *     remainder character index within that chunk.
 * @private
 */
mobwrite.SimpleDiffer.prototype.findChunk_ = function(targetCharIndex) {
  var currentCharIndex = 0;
  for (var i = 0, chunk; chunk = this.chunks_[i]; i++) {
    if (currentCharIndex + chunk.length > targetCharIndex) {
      return [ i, targetCharIndex - currentCharIndex ];
    }
    currentCharIndex += chunk.length;
  }
};


/**
 * Merges adjacent insert chunks.
 * @private
 */
mobwrite.SimpleDiffer.prototype.mergeInserts_ = function() {
  var prevInsert = null;
  for (var i = 0; i < this.chunks_.length; i++) {
    var chunk = this.chunks_[i];
    if (chunk.type == 'insert') {
      if (chunk.text == '') {
        this.chunks_.splice(i, 1);
      } else if (prevInsert) {
        prevInsert.text += chunk.text;
        prevInsert.length += chunk.length;
        this.chunks_.splice(i, 1);
        i--;
      } else {
        prevInsert = chunk;
      }
    } else {
      prevInsert = null;
    }
  }
};


/**
 * Create a simple diff representing the mutations performed.
 * @return {Array.<Object>} The mutations from the simple diff, sorted from
 *     the end of the source to the beginning.
 */
mobwrite.SimpleDiffer.prototype.getSimpleDiff = function() {
  this.mergeInserts_();
  var simpleDiff = [];
  var lastCopyCharIndex = Infinity;
  for (var i = this.chunks_.length - 1; i >= 0; i--) {
    var chunk = this.chunks_[i];
    if (chunk.type == 'copy') {
      var deletedChars = lastCopyCharIndex - (chunk.start + chunk.length);
      if (deletedChars > 0) {
        simpleDiff.push({
          type: 'delete',
          start: chunk.start + chunk.length,
          end: chunk.start +  chunk.length + deletedChars
        });
      }
      lastCopyCharIndex = chunk.start;
    } else if (chunk.type == 'insert') {
      simpleDiff.push({
        type: 'insert',
        start: lastCopyCharIndex,
        text: chunk.text
      })
    }
  }
  // Merge adjacent deletes in the simple diff. This is a very important
  // optimization -- without it, thousands of adjacent delete operations
  // generated by diff_match_patch.
  var prevDelete = null;
  for (var i = simpleDiff.length - 1; i >= 0; i--) {
    var action = simpleDiff[i];
    if (action.type == 'delete') {
      if (prevDelete) {
        if (prevDelete.end == action.start) {
          // Expand the previous delete mutation to include the contents of
          // the current one. Then, remove the current one from the simple diff.
          prevDelete.end = action.end;
          simpleDiff.splice(i, 1);
          continue;
        }
      }
      prevDelete = action;
    } else {
      prevDelete = null;
    }
  }
  return simpleDiff;
};

