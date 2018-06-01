/* global sprintf */

/* exported Sat SatImage SatLabel ImageLabel */

/*
 Utilities
 */

let COLOR_PALETTE = [
  [31, 119, 180],
  [174, 199, 232],
  [255, 127, 14],
  [255, 187, 120],
  [44, 160, 44],
  [152, 223, 138],
  [214, 39, 40],
  [255, 152, 150],
  [148, 103, 189],
  [197, 176, 213],
  [140, 86, 75],
  [196, 156, 148],
  [227, 119, 194],
  [247, 182, 210],
  [127, 127, 127],
  [199, 199, 199],
  [188, 189, 34],
  [219, 219, 141],
  [23, 190, 207],
  [158, 218, 229],
];

/**
 * Summary: Tune the shade or tint of rgb color
 * @param {[number,number,number]} rgb: input color
 * @param {[number,number,number]} base: base color (white or black)
 * @param {number} ratio: blending ratio
 * @return {[number,number,number]}
 */
function blendColor(rgb, base, ratio) {
  let newRgb = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    newRgb[i] = Math.max(0,
        Math.min(255, rgb[i] + Math.round((base[i] - rgb[i]) * ratio)));
  }
  return newRgb;
}

/**
 * Pick color from the palette. Add additional shades and tints to increase
 * the color number. Results: https://jsfiddle.net/739397/e980vft0/
 * @param {[int]} index: palette index
 * @return {[number,number,number]}
 */
function pickColorPalette(index) {
  let colorIndex = index % COLOR_PALETTE.length;
  let shadeIndex = (Math.floor(index / COLOR_PALETTE.length)) % 3;
  let rgb = COLOR_PALETTE[colorIndex];
  if (shadeIndex === 1) {
    rgb = blendColor(rgb, [255, 255, 255], 0.4);
  } else if (shadeIndex === 2) {
    rgb = blendColor(rgb, [0, 0, 0], 0.2);
  }
  return rgb;
}

/**
 * Base class for each labeling session/task
 * @param {SatItem} ItemType: item instantiation type
 * @param {SatLabel} LabelType: label instantiation type
 */
function Sat(ItemType, LabelType) {
  this.items = []; // a.k.a ImageList, but can be 3D model list
  this.labels = []; // list of label objects
  this.labelIdMap = {};
  this.lastLabelId = -1;
  this.currentItem = null;
  this.ItemType = ItemType;
  this.LabelType = LabelType;
  this.events = [];
  this.startTime = Date.now();
  this.taskId = null;
  this.projectName = null;
  this.getIpInfo();
}

/**
 * Store IP information describing the user using the freegeoip service.
 */
Sat.prototype.getIpInfo = function() {
  let self = this;
  $.getJSON('http://freegeoip.net/json/?callback=?', function(data) {
    self.ipInfo = data;
  });
};

/**
 * Create a new item for this SAT.
 * @param {string} url - Location of the new item.
 * @return {SatItem} - The new item.
 */
Sat.prototype.newItem = function(url) {
  let self = this;
  let item = new self.ItemType(self, self.items.length, url);
  self.items.push(item);
  return item;
};

/**
 * Get a new label ID.
 * @return {int} - The new label ID.
 */
Sat.prototype.newLabelId = function() {
  let newId = this.lastLabelId + 1;
  this.lastLabelId = newId;
  return newId;
};

/**
 * Create a new label for this SAT.
 * @param {object} optionalAttributes - Optional attributes that may be used by
 *   subclasses of SatLabel.
 * @return {SatLabel} - The new label.
 */
Sat.prototype.newLabel = function(optionalAttributes) {
  let self = this;
  let label = new self.LabelType(self, self.newLabelId(), optionalAttributes);
  self.labelIdMap[label.id] = label;
  self.labels.push(label);
  self.currentItem.labels.push(label);
  return label;
};

/**
 * Add an event to this SAT.
 * @param {string} action - The action triggering the event.
 * @param {int} itemIndex - Index of the item on which the event occurred.
 * @param {int} labelId - ID of the label pertaining to the event.
 * @param {object} position - Object storing some representation of position at
 *   which this event occurred.
 */
Sat.prototype.addEvent = function(action, itemIndex, labelId = -1,
                                  position = null) {
  this.events.push({
    timestamp: Date.now(),
    action: action,
    itemIndex: itemIndex,
    labelId: labelId,
    position: position,
  });
};

/**
 * Go to an item in this SAT, setting it to active.
 * @param {int} index - Index of the item to go to.
 */
Sat.prototype.gotoItem = function(index) {
  let self = this;
  // mod the index to wrap around the list
  index = index % self.items.length;
  // TODO: event?
  self.currentItem.setActive(false);
  self.currentItem = self.items[index];
  self.currentItem.setActive(true);
  self.currentItem.onload = function() {
    self.currentItem.redraw();
  };
  self.currentItem.redraw();
};

/**
 * Load this SAT from the back end.
 */
Sat.prototype.load = function() {
  let self = this;
  let xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      let json = JSON.parse(xhr.response);
      self.fromJson(json);
    }
  };
  // get params from url path. These uniquely identify a SAT.
  let searchParams = new URLSearchParams(window.location.search);
  self.taskIndex = parseInt(searchParams.get('task_index'));
  self.projectName = searchParams.get('project_name');
  // send the request to the back end
  let request = JSON.stringify({
    'index': self.taskIndex,
    'projectName': self.projectName,
  });
  xhr.open('POST', './postLoadTask', false);
  xhr.send(request);
};

/**
 * Save this labeling session to file by sending JSON to the back end.
 */
Sat.prototype.save = function() {
  let self = this;
  let json = self.toJson();
  let xhr = new XMLHttpRequest();
  xhr.open('POST', './postSave');
  xhr.send(JSON.stringify(json));
};

/**
 * Get this session's JSON representation
 * @return {{items: Array, labels: Array, events: *, userAgent: string}}
 */
Sat.prototype.toJson = function() {
  let self = this;
  return self.encodeBaseJson();
};

/**
 * Encode the base SAT objects. This should NOT be overloaded. Instead,
 * overload Sat.prototype.toJson()
 * @return {object} - JSON representation of the base functionality in this
 *   SAT. */
Sat.prototype.encodeBaseJson = function() {
  let self = this;
  let items = [];
  for (let i = 0; i < self.items.length; i++) {
    items.push(self.items[i].toJson());
  }
  let labels = [];
  for (let i = 0; i < self.labels.length; i++) {
    if (self.labels[i].valid) {
      labels.push(self.labels[i].toJson());
    }
  }
  return {
    projectName: self.projectName,
    startTime: self.startTime,
    items: items,
    labels: labels,
    categories: self.categories,
    events: self.events,
    userAgent: navigator.userAgent,
    ipInfo: self.ipInfo,
  };
};

/**
 * Initialize this session from a JSON representation
 * @param {string} json - The JSON representation.
 */
Sat.prototype.fromJson = function(json) {
  let self = this;
  self.decodeBaseJson(json);
};

/**
 * Decode the base SAT objects. This should NOT be overloaded. Instead,
 * overload Sat.prototype.fromJson()
 * @param {string} json - The JSON representation.
 */
Sat.prototype.decodeBaseJson = function(json) {
  let self = this;
  for (let i = 0; json.labels && i < json.labels.length; i++) {
    // keep track of highest label ID
    self.lastLabelId = Math.max(self.lastLabelId, json.labels[i].id);
    let newLabel = new self.LabelType(self, json.labels[i].id);
    newLabel.fromJsonVariables(json.labels[i]);
    self.labelIdMap[newLabel.id] = newLabel;
    self.labels.push(newLabel);
  }
  for (let i = 0; i < json.items.length; i++) {
    let newItem = self.newItem(json.items[i].url);
    newItem.fromJson(json.items[i]);
  }
  self.currentItem = self.items[0];
  self.currentItem.setActive(true);
  self.categories = json.categories;

  for (let i = 0; json.labels && i < json.labels.length; i++) {
    self.labelIdMap[json.labels[i].id].fromJsonPointers(json.labels[i]);
  }
  self.addEvent('start labeling', self.currentItem.index);
};


/**
 * Base class for each labeling target, can be pointcloud or 2D image
 * @param {Sat} sat: context
 * @param {number} index: index of this item in sat
 * @param {string} url: url to load the item
 */
function SatItem(sat, index = -1, url = '') {
  let self = this;
  self.sat = sat;
  self.index = index;
  self.url = url;
  self.labels = [];
  self.ready = false; // is this needed?
}

/**
 * Called when this item is loaded.
 */
SatItem.prototype.loaded = function() {
  this.ready = true;
  this.sat.addEvent('loaded', this.index);
};

/**
 * Get the item before this one.
 * @return {SatItem} the item before this one
 */
SatItem.prototype.previousItem = function() {
  if (this.index === 0) {
    return null;
  }
  return this.sat.items[this.index-1];
};

/**
 * Get the SatItem after this one.
 * @return {SatItem} the item after this one
 */
SatItem.prototype.nextItem = function() {
  if (this.index + 1 >= this.sat.items.length) {
    return null;
  }
  return this.sat.items[this.index+1];
};

/**
 * Get this SatItem's JSON representation.
 * @return {object} JSON representation of this item
 */
SatItem.prototype.toJson = function() {
  let self = this;
  let labelIds = [];
  for (let i = 0; i < self.labels.length; i++) {
    if (self.labels[i].valid) {
      labelIds.push(self.labels[i].id);
    }
  }
  return {url: self.url, index: self.index, labelIds: labelIds};
};

/**
 * Restore this SatItem from JSON.
 * @param {object} selfJson - JSON representation of this SatItem.
 * @param {string} selfJson.url - This SatItem's url.
 * @param {number} selfJson.index - This SatItem's index in
 * @param {list} selfJson.labelIds - The list of label ids of this SatItem's
 *   SatLabels.
 */
SatItem.prototype.fromJson = function(selfJson) {
  let self = this;
  self.url = selfJson.url;
  self.index = selfJson.index;
  if (selfJson.labelIds) {
    for (let i = 0; i < selfJson.labelIds.length; i++) {
      self.labels.push(self.sat.labelIdMap[selfJson.labelIds[i]]);
    }
  }
};

/**
 * Get all the visible labels in this SatItem.
 * @return {Array} list of all visible labels in this SatItem
 */
SatItem.prototype.getVisibleLabels = function() {
  let labels = [];
  for (let i = 0; i < this.labels.length; i++) {
    if (this.labels[i].valid && this.labels[i].numChildren === 0) {
      labels.push(this.labels[i]);
    }
  }
  return labels;
};

// TODO: remove this function
SatItem.prototype.deleteLabelById = function(labelId, back = true) {
  // TODO: refactor this ugly code
  let self = this;
  for (let i = 0; i < self.labels.length; i++) {
    if (self.labels[i].id === labelId) {
      let currentItem = self.previousItem();
      let currentLabel = self.sat.labelIdMap[self.labels[i].previousLabelId];
      while (back && currentItem) {
        for (let j = 0; j < currentItem.labels.length; j++) {
          if (currentItem.labels[j].id === currentLabel.id) {
            currentItem.labels.splice(j, 1);
            if (currentItem.selectedLabel &&
              currentItem.selectedLabel.id === currentLabel.id) {
              currentItem.selectedLabel = null;
              currentItem.currHandle = null;
            }
          }
        }
        if (currentLabel) {
          currentLabel = self.sat.labelIdMap[currentLabel.previousLabelId];
        }
        currentItem = currentItem.previousItem();
      }
      currentItem = self.nextItem();
      currentLabel = self.sat.labelIdMap[self.labels[i].nextLabelId];
      while (currentItem) {
        for (let j = 0; j < currentItem.labels.length; j++) {
          if (currentItem.labels[j].id === currentLabel.id) {
            currentItem.labels.splice(j, 1);
            if (currentItem.selectedLabel &&
              currentItem.selectedLabel.id === currentLabel.id) {
              currentItem.selectedLabel = null;
              currentItem.currHandle = null;
            }
          }
        }
        if (currentLabel) {
          currentLabel = self.sat.labelIdMap[currentLabel.nextLabelId];
        }
        currentItem = currentItem.nextItem();
      }
      self.labels.splice(i, 1);
      if (self.selectedLabel && self.selectedLabel.id === labelId) {
        self.selectedLabel = null;
        self.currHandle = null;
      }
      return;
    }
  }
};


/**
 * Base class for each targeted labeling Image.
 *
 * To define a new tool:
 *
 * function NewTool() {
 *   SatImage.call(this, sat, index, url);
 * }
 *
 * NewTool.prototype = Object.create(SatImage.prototype);
 *
 * @param {Sat} sat: context
 * @param {number} index: index of this item in sat
 * @param {string} url: url to load the item
 */
function SatImage(sat, index, url) {
  let self = this;
  SatItem.call(self, sat, index, url);
  self.image = new Image();
  self.image.onload = function() {
    self.loaded();
  };
  self.image.src = self.url;
}

SatImage.prototype = Object.create(SatItem.prototype);

/**
 * Set whether this SatImage is the active one in the sat instance.
 * @param {boolean} active: if this SatImage is active
 */
SatImage.prototype.setActive = function(active) {
  let self = this;
  self.active = active;
  if (active) {
    self.imageCanvas = document.getElementById('image_canvas');
    self.hiddenCanvas = document.getElementById('hidden_canvas');
    self.mainCtx = self.imageCanvas.getContext('2d');
    self.hiddenCtx = self.hiddenCanvas.getContext('2d');
    self.state = 'free';
    self.lastLabelID = -1;
    self.padBox = self._getPadding();
    self.catSel = document.getElementById('category_select');
    self.catSel.selectedIndex = 0;
    self.occlCheckbox = document.getElementById('occluded_checkbox');
    self.truncCheckbox = document.getElementById('truncated_checkbox');
    document.getElementById('prev_btn').onclick = function() {
      self.sat.gotoItem(self.index - 1);
    };
    document.getElementById('next_btn').onclick = function() {
      self.sat.gotoItem(self.index + 1);
    };
    document.onmousedown = function(e) {
      self._mousedown(e);
    };
    document.onmousemove = function(e) {
      self._mousemove(e);
    };
    document.onmouseup = function(e) {
      self._mouseup(e);
    };
    $('#category_select').change(function() {
      self._changeCat();
    });
    $('[name=\'occluded-checkbox\']').on('switchChange.bootstrapSwitch',
    function() {
      self._occlSwitch();
    });
    $('[name=\'truncated-checkbox\']').on('switchChange.bootstrapSwitch',
    function() {
      self._truncSwitch();
    });
    // TODO: Wenqi
    // traffic light color
    if ($('#end_btn').length) {
      // if the end button exists (we have a sequence) then hook it up
      $('#end_btn').click(function() {
        if (self.selectedLabel) {
          self.deleteLabelById(self.selectedLabel.id, false);
          self.redraw();
        }
      });
    }
    if ($('#delete_btn').length) {
      $('#delete_btn').click(function() {
        if (self.selectedLabel) {
          self.deleteLabelById(self.selectedLabel.id);
          self.redraw();
        }
      });
    }
    if ($('#remove_btn').length) {
      $('#remove_btn').click(function() {
        if (self.selectedLabel) {
          self.selectedLabel.delete();
          self.selectedLabel = null;
        }
      });
    }
  } else {
    // .click just adds a function to a list of functions that get executed,
    // therefore we need to turn off the old functions
    if ($('#end_btn').length) {
      $('#end_btn').off();
    }
    if ($('#delete_btn').length) {
      $('#delete_btn').off();
    }
    if ($('#remove_btn').length) {
      $('#remove_btn').off();
    }
  }
};

/**
 * Redraws this SatImage and all labels.
 */
SatImage.prototype.redraw = function() {
  let self = this;
  self.padBox = self._getPadding();
  self.mainCtx.clearRect(0, 0, self.imageCanvas.width,
    self.imageCanvas.height);
  self.hiddenCtx.clearRect(0, 0, self.hiddenCanvas.width,
    self.hiddenCanvas.height);
  self.mainCtx.drawImage(self.image, 0, 0, self.image.width, self.image.height,
    self.padBox.x, self.padBox.y, self.padBox.w, self.padBox.h);
  for (let i = 0; i < self.labels.length; i++) {
    self.labels[i].redraw(self.mainCtx, self.hiddenCtx, self.selectedLabel,
      self.resizeID === self.labels[i].id, self.hoverLabel,
        self.hoverHandle, i);
  }
};

/**
 * Called when this SatImage is active and the mouse is clicked.
 * @param {object} e: mouse event
 */
SatImage.prototype._mousedown = function(e) {
  let self = this;
  if (self._isWithinFrame(e) && self.state === 'free') {
    let mousePos = self._getMousePos(e);
    [self.selectedLabel, self.currHandle] = self._getSelected(mousePos);
    // change checked traits on label selection
    if (self.selectedLabel) {
      for (let i = 0; i < self.catSel.options.length; i++) {
        if (self.catSel.options[i].innerHTML ===
          self.selectedLabel.categoryPath) {
          self.catSel.selectedIndex = i;
          break;
        }
      }
      if ($('[name=\'occluded-checkbox\']').prop('checked') !==
        self.selectedLabel.occl) {
        $('[name=\'occluded-checkbox\']').trigger('click');
      }
      if ($('[name=\'truncated-checkbox\']').prop('checked') !==
        self.selectedLabel.trunc) {
        $('[name=\'truncated-checkbox\']').trigger('click');
      }
      // TODO: Wenqi
      // traffic light color
    }

    if (self.selectedLabel && self.currHandle > 0) {
      // if we have a resize handle
      self.state = 'resize';
      self.resizeID = self.selectedLabel.id;
    } else if (self.currHandle === 0 && self.selectedLabel) {
      // if we have a move handle
      self.movePos = self.selectedLabel.getCurrentPosition();
      self.moveClickPos = mousePos;
      self.state = 'move';
    } else if (!self.selectedLabel) {
      // otherwise, new label
      let cat = self.catSel.options[self.catSel.selectedIndex].innerHTML;
      let occl = self.occlCheckbox.checked;
      let trunc = self.truncCheckbox.checked;
      self.selectedLabel = self.sat.newLabel({categoryPath: cat, occl: occl,
        trunc: trunc, mousePos: mousePos});
      self.state = 'resize';
      self.currHandle = self.selectedLabel.INITIAL_HANDLE;
      self.resizeID = self.selectedLabel.id;
    }
  }
  self.redraw();
};

/**
 * Called when this SatImage is active and the mouse is moved.
 * @param {object} e: mouse event
 */
SatImage.prototype._mousemove = function(e) {
  let self = this;
  let canvRect = this.imageCanvas.getBoundingClientRect();
  let mousePos = self._getMousePos(e);

  // draw the crosshair
  let cH = $('#crosshair-h');
  let cV = $('#crosshair-v');
  cH.css('top', Math.min(canvRect.y + self.padBox.y + self.padBox.h, Math.max(
    e.clientY, canvRect.y + self.padBox.y)));
  cH.css('left', canvRect.x + self.padBox.x);
  cH.css('width', self.padBox.w);
  cV.css('left', Math.min(canvRect.x + self.padBox.x + self.padBox.w, Math.max(
    e.clientX, canvRect.x + self.padBox.x)));
  cV.css('top', canvRect.y + self.padBox.y);
  cV.css('height', self.padBox.h);
  if (self._isWithinFrame(e)) {
    $('.hair').show();
  } else {
    $('.hair').hide();
  }

  // needed for on-hover animations
  [self.hoverLabel, self.hoverHandle] = self._getSelected(mousePos);
  // change the cursor appropriately
  if (self.state === 'resize') {
    self.imageCanvas.style.cursor = 'crosshair';
  } else if (self.state === 'move') {
    self.imageCanvas.style.cursor = 'move';
  } else if (self.hoverLabel && self.hoverHandle >= 0) {
    self.imageCanvas.style.cursor = self.hoverLabel.getCursorStyle(
      self.hoverHandle);
  } else {
    self.imageCanvas.style.cursor = 'crosshair';
  }

  if (self.state === 'resize') {
    self.selectedLabel.resize(mousePos, self.currHandle, canvRect, self.padBox);
  } else if (self.state === 'move') {
    self.selectedLabel.move(mousePos, self.movePos, self.moveClickPos,
      self.padBox);
  }
  self.redraw();
};

/**
 * Called when this SatImage is active and the mouse is released.
 * @param {object} _: mouse event (unused)
 */
SatImage.prototype._mouseup = function(_) { // eslint-disable-line
  let self = this;
  if (self.state !== 'free') {
    if (self.state === 'resize') {
      // if we resized, we need to reorder ourselves
      if (self.selectedLabel.w < 0) {
        self.selectedLabel.x = self.selectedLabel.x + self.selectedLabel.w;
        self.selectedLabel.w = -1 * self.selectedLabel.w;
      }
      if (self.selectedLabel.h < 0) {
        self.selectedLabel.y = self.selectedLabel.y + self.selectedLabel.h;
        self.selectedLabel.h = -1 * self.selectedLabel.h;
      }
      // remove the box if it's too small
      if (self.selectedLabel.isSmall()) {
        self.selectedLabel.delete();
        self.selectedLabel = null;
      }
    }
    self.state = 'free';
    self.resizeID = null;
    self.movePos = null;
    self.moveClickPos = null;
  }
  // if parent label, make this the selected label in all other SatImages
  if (self.selectedLabel && self.selectedLabel.parent) {
    let currentItem = self.previousItem();
    let currentLabel = self.sat.labelIdMap[self.selectedLabel.previousLabelId];
    while (currentItem) {
      currentItem.selectedLabel = currentLabel;
      currentItem.currHandle = currentItem.selectedLabel.INITIAL_HANDLE;
      if (currentLabel) {
        currentLabel = self.sat.labelIdMap[currentLabel.previousLabelId];
        // TODO: make both be functions, not attributes
      }
      currentItem = currentItem.previousItem();
    }
    currentItem = self.nextItem();
    currentLabel = self.sat.labelIdMap[self.selectedLabel.nextLabelId];
    while (currentItem) {
      currentItem.selectedLabel = currentLabel;
      currentItem.currHandle = currentItem.selectedLabel.INITIAL_HANDLE;
      if (currentLabel) {
        currentLabel = self.sat.labelIdMap[currentLabel.nextLabelId];
      }
      currentItem = currentItem.nextItem();
    }
  }
  self.redraw();
};

/**
 * True if mouse is within the image frame (tighter bound than canvas).
 * @param {object} e: mouse event
 * @return {boolean}: whether the mouse is within the image frame
 */
SatImage.prototype._isWithinFrame = function(e) {
  let rect = this.imageCanvas.getBoundingClientRect();
  return (this.padBox && rect.x + this.padBox.x < e.clientX && e.clientX <
    rect.x + this.padBox.x + this.padBox.w && rect.y + this.padBox.y <
    e.clientY && e.clientY < rect.y + this.padBox.y + this.padBox.h);
};

/**
 * Get the mouse position on the canvas.
 * @param {object} e: mouse event
 * @return {object}: mouse position (x,y) on the canvas
 */
SatImage.prototype._getMousePos = function(e) {
  let rect = this.imageCanvas.getBoundingClientRect();
  return {x: e.clientX - rect.x, y: e.clientY - rect.y};
};

/**
 * Get the padding for the image given its size and canvas size.
 * @return {object}: padding box (x,y,w,h)
 */
SatImage.prototype._getPadding = function() {
  // which dim is bigger compared to canvas
  let xRatio = this.image.width / this.imageCanvas.width;
  let yRatio = this.image.height / this.imageCanvas.height;
  // use ratios to determine how to pad
  let box = {x: 0, y: 0, w: 0, h: 0};
  if (xRatio >= yRatio) {
    box.x = 0;
    box.y = 0.5 * (this.imageCanvas.height - this.imageCanvas.width *
      this.image.height / this.image.width);
    box.w = this.imageCanvas.width;
    box.h = this.imageCanvas.height - 2 * box.y;
  } else {
    box.x = 0.5 * (this.imageCanvas.width - this.imageCanvas.height *
      this.image.width / this.image.height);
    box.y = 0;
    box.w = this.imageCanvas.width - 2 * box.x;
    box.h = this.imageCanvas.height;
  }
  return box;
};

/**
 * Get the label with a given id.
 * @param {number} labelID: id of the sought label
 * @return {ImageLabel}: the sought label
 */
SatImage.prototype._getLabelByID = function(labelID) {
  for (let i = 0; i < this.labels.length; i++) {
    if (this.labels[i].id === labelID) {
      return this.labels[i];
    }
  }
};

/**
 * Get the box and handle under the mouse.
 * @param {object} mousePos: canvas mouse position (x,y)
 * @return {[ImageLabel, number]}: the box and handle (0-9) under the mouse
 */
SatImage.prototype._getSelected = function(mousePos) {
  let self = this;
  let pixelData = this.hiddenCtx.getImageData(mousePos.x,
    mousePos.y, 1, 1).data;
  let selectedLabelIndex = null;
  let currHandle = null;
  if (pixelData[3] !== 0) {
    selectedLabelIndex = pixelData[0] * 256 + pixelData[1];
    currHandle = pixelData[2] - 1;
  }
  return [self.labels[selectedLabelIndex], currHandle];
};

/**
 * Called when the selected category is changed.
 */
SatImage.prototype._changeCat = function() {
  let self = this;
  if (self.selectedLabel) {
    let option = self.catSel.options[self.catSel.selectedIndex].innerHTML;
    self.selectedLabel.categoryPath = option;
    self.redraw();
  }
};

/**
 * Called when the occluded checkbox is toggled.
 */
SatImage.prototype._occlSwitch = function() {
  let self = this;
  if (self.selectedLabel) {
    self.selectedLabel.occl = $('[name=\'occluded-checkbox\']').prop('checked');
  }
};

/**
 * Called when the truncated checkbox is toggled.
 */
SatImage.prototype._truncSwitch = function() {
  let self = this;
  if (self.selectedLabel) {
    self.selectedLabel.trunc = $('[name=\'truncated-checkbox\']').prop(
      'checked');
  }
};

/**
 * Called when the traffic light color choice is changed.
 */
SatImage.prototype._lightSwitch = function() {
  // TODO: Wenqi
};


/**
 * Base class for all the labeled objects. New label should be instantiated by
 * Sat.newLabel()
 *
 * To define a new tool:
 *
 * function NewObject(id) {
 *   SatLabel.call(this, id);
 * }
 *
 * NewObject.prototype = Object.create(SatLabel.prototype);
 *
 * @param {Sat} sat: The labeling session
 * @param {number | null} id: label object identifier
 * @param {object} ignored: ignored parameter for optional attributes.
 */
function SatLabel(sat, id = -1, ignored = null) {
  this.id = id;
  this.categoryPath = null;
  this.attributes = {};
  this.sat = sat;
  this.parent = null;
  this.children = [];
  this.numChildren = 0;
  this.valid = true;
}

SatLabel.prototype.delete = function() {
  this.valid = false;
  if (this.parent !== null) {
    this.parent.numChildren -= 1;
    if (this.parent.numChildren === 0) this.parent.delete();
  }
  for (let i = 0; i < this.children.length; i++) {
    this.children[i].parent = null;
    this.children[i].delete();
  }
};

SatLabel.prototype.getRoot = function() {
  if (this.parent === null) return this;
  else return this.parent.getRoot();
};

/**
 * Get the current position of this label.
 */
SatLabel.prototype.getCurrentPosition = function() {

};

SatLabel.prototype.addChild = function(child) {
  this.numChildren += 1;
  this.children.push(child);
};

/**
 * Pick a color based on the label id
 * @return {(number|number|number)[]}
 */
SatLabel.prototype.color = function() {
  return pickColorPalette(this.getRoot().id);
};

/**
 * Convert the color to css style
 * @param {number} alpha: color transparency
 * @return {[number,number,number]}
 */
SatLabel.prototype.styleColor = function(alpha = 255) {
  let c = this.color();
  return sprintf('rgba(%d, %d, %d, %f)', c[0], c[1], c[2], alpha);
};

SatLabel.prototype.encodeBaseJson = function() {
  let self = this;
  let json = {id: self.id, categoryPath: self.categoryPath};
  if (self.parent) {
    json.parent = self.parent.id;
  } else {
    json.parent = -1;
  }
  if (self.children && self.children.length > 0) {
    let childrenIds = [];
    for (let i = 0; i < self.children.length; i++) {
      if (self.children[i].valid) {
        childrenIds.push(self.children[i].id);
      }
    }
    json.children = childrenIds;
  }
  json.previousLabelId = -1;
  json.nextLabelId = -1;
  if (self.previousLabelId) {
    json.previousLabelId = self.previousLabelId;
  }
  if (self.nextLabelId) {
    json.nextLabelId = self.nextLabelId;
  }
  // TODO: remove
  json.keyframe = self.keyframe;
  return json;
};

/**
 * Return json object encoding the label information
 * @return {{id: *}}
 */
SatLabel.prototype.toJson = function() {
  let self = this;
  return self.encodeBaseJson();
};

SatLabel.prototype.decodeBaseJsonVariables = function(json) {
  let self = this;
  self.id = json.id;
  self.categoryPath = json.categoryPath;
  // TODO: remove
  self.keyframe = json.keyframe;
  if (json.previousLabelId > -1) {
    self.previousLabelId = json.previousLabelId;
  }
  if (json.nextLabelId > -1) {
    self.nextLabelId = json.nextLabelId;
  }
};

SatLabel.prototype.decodeBaseJsonPointers = function(json) {
  let self = this;
  let labelIdMap = self.sat.labelIdMap;
  if (json.parent > -1) {
    self.parent = labelIdMap[json.parent];
  }
  if (json.children) {
    let childrenIds = json.children;
    for (let i = 0; i < childrenIds.length; i++) {
      self.addChild(labelIdMap[childrenIds[i]]);
    }
  }
};

/**
 * Load label information from json object
 * @param {object} json: JSON representation of this SatLabel.
 */
SatLabel.prototype.fromJsonVariables = function(json) {
  let self = this;
  self.decodeBaseJsonVariables(json);
};

SatLabel.prototype.fromJsonPointers = function(json) {
  let self = this;
  self.decodeBaseJsonPointers(json);
};

SatLabel.prototype.startChange = function() {

};

SatLabel.prototype.updateChange = function() {

};

SatLabel.prototype.finishChange = function() {

};

SatLabel.prototype.redraw = function() {

};


/**
 * Base class for all the labeled objects. New label should be instantiated by
 * Sat.newLabel()
 *
 * To define a new tool:
 *
 * function NewObject(sat, id) {
 *   ImageLabel.call(this, sat, id);
 * }
 *
 * NewObject.prototype = Object.create(ImageLabel.prototype);
 *
 * @param {Sat} sat: The labeling session
 * @param {number | null} id: label object identifier
 * @param {object} optionalAttributes: Optional attributes for the SatLabel.
 */
function ImageLabel(sat, id, optionalAttributes = null) {
  SatLabel.call(this, sat, id, optionalAttributes);
}

ImageLabel.prototype = Object.create(SatLabel.prototype);

ImageLabel.prototype.getCurrentPosition = function() {

};

/**
 * Get the weighted average between this label and a provided label.
 * @param {ImageLabel} ignoredLabel - The other label.
 * @param {number} ignoredWeight - The weight, b/w 0 and 1, higher
 * corresponds to
 *   closer to the other label.
 * @return {object} - The label's position.
 */
ImageLabel.prototype.getWeightedAvg = function(ignoredLabel, ignoredWeight) {
  return null;
};

/**
 * Set this label to be the weighted average of the two provided labels.
 * @param {ImageLabel} ignoredStartLabel - The first label.
 * @param {ImageLabel} ignoredEndLabel - The second label.
 * @param {number} ignoredWeight - The weight, b/w 0 and 1, higher
 *   corresponds to closer to endLabel.
 */
ImageLabel.prototype.weightedAvg = function(ignoredStartLabel, ignoredEndLabel,
                                            ignoredWeight) {

};

/**
 * Calculate the intersection between this and another ImageLabel
 * @param {ImageLabel} ignoredLabel - The other image label.
 * @return {number} - The intersection between the two labels.
 */
ImageLabel.prototype.intersection = function(ignoredLabel) {
  return 0;
};

/**
 * Calculate the union between this and another ImageLabel
 * @param {ImageLabel} ignoredLabel - The other image label.
 * @return {number} - The union between the two labels.
 */
ImageLabel.prototype.union = function(ignoredLabel) {
  return 0;
};
