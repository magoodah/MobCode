/**
 * MobWrite - Real-time Synchronization and Collaboration Service
 *
 * Copyright 2009 Google Inc.
 * http://code.google.com/p/google-mobwrite/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview This client-side code interfaces with CodeMirror.
 * @author fraser@google.com (Neil Fraser)
 * @author bloom@google.com (David Bloom)
 */

/**
 * Constructor of shared object representing a CodeMirror editor.
 * @param {Object} editor A CodeMirror editor.
 * @constructor
 */
mobwrite.shareCodeMirror = function(editor) {
  // Call our prototype's constructor.
  mobwrite.shareObj.apply(this, [editor.id]);
  // Code editors don't usually contain just enum values.
  this.mergeChanges = true;
  this.editor = editor;
};


// The CodeMirror's shared object's parent is a shareObj.
mobwrite.shareCodeMirror.prototype = new mobwrite.shareObj('');


/**
 * Retrieve the user's content.
 * NOTE(bloom): It is very expensive to access this value from CodeMirror.
 * It should be cached and reused whenever feasible.
 * @return {string} Plaintext content.
 */
mobwrite.shareCodeMirror.prototype.getClientText = function() {
  var container = this.editor.editor.container;
  if ('innerText' in container) {
    // The first two replaces are copied from the source of
    // editor.getCode(), and the last one is needed in IE
    // since it adds carriage returns to newlines in innerText.
    return container.innerText.replace(/\u00a0/g, " ")
                              .replace(/\u200b/g, "").replace(/\r/g, "");
  }
  return this.editor.getCode();
};


/**
 * Set the user's content.
 * @param {string} text New content.
 */
mobwrite.shareCodeMirror.prototype.setClientText = function(text) {
  this.editor.setCode(text);
};


/**
 * Gets CodeMirror-formatted DOM positions for character positions within the
 * editor. It is fastest to look them up in batches, since this has to iterate
 * through every newline in the code.
 * @param {string} editorText The text of the editor.
 * @param {Array.<number>} charIndexes The character indexes to look up.
 * @return {Object} A hash table of character indexes mapped to their CodeMirror
 *     DOM positions.
 * @private
 */
mobwrite.shareCodeMirror.prototype.getBrOffsets_ = function(editorText,
                                                            charIndexes) {
  charIndexes.sort(function(a,b){return a-b});
  var brOffsets = {};
  var brElements = this.editor.editor.container.getElementsByTagName('br');
  var brIndex = brElements.length - 1;
  var newlineCharIndex = editorText.length;
  do {
    // Get the next newline in the editor text.
    newlineCharIndex = editorText.lastIndexOf('\n', newlineCharIndex - 1);
    while (newlineCharIndex < charIndexes[charIndexes.length - 1]) {
      // Map this character index to the closest newline that precedes it.
      var targetCharIndex = charIndexes.pop();
      var brElement = (brIndex >= 0) ? (brElements[brIndex] || null) : null;
      brOffsets[targetCharIndex] = {
        node: brElement,
        offset: brElement ? targetCharIndex - newlineCharIndex - 1 :
                            targetCharIndex
      }
      if (charIndexes.length == 0) {
        // Bail out of the loop if there are no more character indexes left to
        // find.
        break;
      }
    }
  } while (newlineCharIndex >= 0 && brIndex-- >= 0);
  // This can happen if the file begins with a newline.
  if (charIndexes.length) {
    if (charIndexes.pop() != 0) {
      throw 'Missing character indexes';
    }
    brOffsets[0] = {
      node: null,
      offset: 0
    };
  }
  return brOffsets;
};


/**
 * Modify the user's plaintext by applying a series of patches against it.
 * @param {Array.<patch_obj>} patches Array of Patch objects.
 */
mobwrite.shareCodeMirror.prototype.patchClientText = function(patches) {
  // Set some constants which tweak the matching behaviour.
  // Maximum distance to search from expected location.
  this.dmp.Match_Distance = 1000;
  // At what point is no match declared (0.0 = perfection, 1.0 = very loose)
  this.dmp.Match_Threshold = 0.6;

  var oldClientText = this.getClientText();
  var simpleDiffer = new mobwrite.SimpleDiffer();
  var newClientText = this.patch_apply_(patches, oldClientText, simpleDiffer);
  // Set the new text only if there is a change to be made.
  if (oldClientText != newClientText) {
    var simpleDiff = simpleDiffer.getSimpleDiff();

    // Look up all the CodeMirror-friendly DOM positions we need.
    // This is fastest if we batch them all up.
    var offsetsNeeded = [];
    for (var i = 0, mutation; mutation = simpleDiff[i]; i++) {
      if (mutation.type == 'insert') {
        offsetsNeeded.push(mutation.start);
      } else if (mutation.type == 'delete') {
        offsetsNeeded.push(mutation.start, mutation.end);
      }
    }

    var brOffsets = this.getBrOffsets_(oldClientText, offsetsNeeded);
    for (var i = 0, mutation; mutation = simpleDiff[i]; i++) {
      if (mutation.type == 'insert') {
        // NOTE(bloom): Editor::insertIntoLine fails on an empty document. Using
        // replaceRange works reliably though.
        this.editor.editor.replaceRange(
            brOffsets[mutation.start],
            brOffsets[mutation.start],
            mutation.text);
      } else if (mutation.type == 'delete') {
        this.editor.editor.replaceRange(
            brOffsets[mutation.start],
            brOffsets[mutation.end],
            '');
      }
    }
  }
};


/**
 * Merge a set of patches onto the text.  Return a patched text.
 * @param {Array.<patch_obj>} patches Array of patch objects.
 * @param {string} text Old text.
 * @param {mobwrite.SimpleDiffer} simpleDiffer A simple differ to record the
 *     patching actions on.
 * @return {string} New text.
 */
mobwrite.shareCodeMirror.prototype.patch_apply_ = function(patches, text,
    simpleDiffer) {
  if (patches.length == 0) {
    return text;
  }

  // Deep copy the patches so that no changes are made to originals.
  patches = this.dmp.patch_deepCopy(patches);
  var nullPadding = this.dmp.patch_addPadding(patches);
  var nullPaddingLength = nullPadding.length;
  text = nullPadding + text + nullPadding;

  this.dmp.patch_splitMax(patches);
  // delta keeps track of the offset between the expected and actual location
  // of the previous patch.  If there are patches expected at positions 10 and
  // 20, but the first patch was found at 12, delta is 2 and the second patch
  // has an effective expected position of 22.
  var delta = 0;
  for (var x = 0; x < patches.length; x++) {
    var expected_loc = patches[x].start2 + delta;
    var text1 = this.dmp.diff_text1(patches[x].diffs);
    var start_loc;
    var end_loc = -1;
    if (text1.length > this.dmp.Match_MaxBits) {
      // patch_splitMax will only provide an oversized pattern in the case of
      // a monster delete.
      start_loc = this.dmp.match_main(text,
          text1.substring(0, this.dmp.Match_MaxBits), expected_loc);
      if (start_loc != -1) {
        end_loc = this.dmp.match_main(text,
            text1.substring(text1.length - this.dmp.Match_MaxBits),
            expected_loc + text1.length - this.dmp.Match_MaxBits);
        if (end_loc == -1 || start_loc >= end_loc) {
          // Can't find valid trailing context.  Drop this patch.
          start_loc = -1;
        }
      }
    } else {
      start_loc = this.dmp.match_main(text, text1, expected_loc);
    }
    if (start_loc == -1) {
      // No match found.  :(
      if (mobwrite.debug) {
        window.console.warn('Patch failed: ' + patches[x]);
      }
      // Subtract the delta for this failed patch from subsequent patches.
      delta -= patches[x].length2 - patches[x].length1;
    } else {
      // Found a match.  :)
      if (mobwrite.debug) {
        window.console.info('Patch OK.');
      }
      delta = start_loc - expected_loc;
      var text2;
      if (end_loc == -1) {
        text2 = text.substring(start_loc, start_loc + text1.length);
      } else {
        text2 = text.substring(start_loc, end_loc + this.dmp.Match_MaxBits);
      }
      // Run a diff to get a framework of equivalent indices.
      var diffs = this.dmp.diff_main(text1, text2, false);
      if (text1.length > this.dmp.Match_MaxBits &&
          this.dmp.diff_levenshtein(diffs) / text1.length >
          this.dmp.Patch_DeleteThreshold) {
        // The end points match, but the content is unacceptably bad.
        if (mobwrite.debug) {
          window.console.warn('Patch contents mismatch: ' + patches[x]);
        }
      } else {
        var index1 = 0;
        var index2;
        for (var y = 0; y < patches[x].diffs.length; y++) {
          var mod = patches[x].diffs[y];
          if (mod[0] !== DIFF_EQUAL) {
            index2 = this.dmp.diff_xIndex(diffs, index1);
          }
          if (mod[0] === DIFF_INSERT) {  // Insertion
            text = text.substring(0, start_loc + index2) + mod[1] +
                   text.substring(start_loc + index2);
            simpleDiffer.applyInsert(
                start_loc + index2 - nullPaddingLength,
                mod[1]);
          } else if (mod[0] === DIFF_DELETE) {  // Deletion
            var del_start = start_loc + index2;
            var del_end = start_loc + this.dmp.diff_xIndex(diffs,
                index1 + mod[1].length);
            text = text.substring(0, del_start) + text.substring(del_end);
            simpleDiffer.applyDelete(
                del_start - nullPadding.length,
                del_end - nullPadding.length);
          }
          if (mod[0] !== DIFF_DELETE) {
            index1 += mod[1].length;
          }
        }
      }
    }
  }
  // Strip the padding off.
  text = text.substring(nullPadding.length, text.length - nullPadding.length);
  return text;
};


/**
 * Handler to accept CodeMirror editors as elements that can be shared.
 * If the element is an editor, create a new sharing object.
 * @param {*} node Object or ID of object to share.
 * @return {Object?} A sharing object or null.
 */
mobwrite.shareCodeMirror.shareHandler = function(node) {
  if (node instanceof CodeMirror) {
    return new mobwrite.shareCodeMirror(node);
  }
  return null;
};


// Register this shareHandler with MobWrite.
mobwrite.shareHandlers.push(mobwrite.shareCodeMirror.shareHandler);

/**
 * Embed CodeMirror onto a webpage.
 * Technically not part of MobWrite.
 * @param {Node|string} textarea Textarea or textarea ID to share.
 * @param {Object} options Set of key/value pairs to configure CodeMirror.
 */
mobwrite.shareCodeMirror.create = function(textarea, options) {
  // Convert a textarea ID into a textarea.
  if (typeof textarea == 'string') {
    textarea = document.getElementById(textarea);
  }
  // Unless content was otherwise specified, use the textarea's contents.
  if (!('content' in options)) {
    options.content = textarea.value;
  }
  // Replace the textarea with a CodeMirror editor.
  var home = document.createElement("DIV");
  var place = CodeMirror.replace(textarea);
  place(home);
  var cm = new CodeMirror(home, options);
  cm.id = textarea.id || textarea.name;
  return cm;
};

