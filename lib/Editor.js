var _ = require('lodash');
var fs = require('fs');
var fsPromises = fs.promises;
var extname = require('path').extname;
require('es6-set/implement'); // required for text-buffer
var TextBuffer = require('text-buffer');
var Point = require('text-buffer/lib/point');
var Range = require('text-buffer/lib/range');
var copyPaste = require('copy-paste');
var util_ = require('util');
var clipboardCopy = util_.promisify(copyPaste.copy);
var clipboardPaste = util_.promisify(copyPaste.paste);

var util = require('./util');
var word = require('./word');
var editorWidgetOpts = require('./opts');
var highlightClient = require('./highlight/client');

var BaseWidget = require('./BaseWidget');

class Editor extends BaseWidget {
  constructor(opts) {
    opts = _.merge({
      focusable: true,
      multiLine: true
    }, editorWidgetOpts.editor, opts);
    super(opts);
    var self = this;

    self.gutter = new BaseWidget(_.merge({
      parent: self,
      tags: true,
      wrap: false,
      style: {},
      top: 0,
      left: 0,
      bottom: 0
    }, self.options.gutter));

    self.buffer = new BaseWidget(_.merge({
      parent: self,
      tags: true,
      wrap: false,
      style: {},
      top: 0,
      left: self.options.multiLine && !self.gutter.options.hidden ? self.gutter.width : 0,
      right: 0,
      bottom: 0
    }, self.options.buffer));

    self.textBuf = new TextBuffer({
      encoding: self.options.defaultEncoding,
      text: self.options.text
    });

    if (!self.options.text) {
      self.textBuf.loadSync();
    }

    self.selection = self.textBuf.markPosition(new Point(0, 0), { invalidate: 'never' });
    self.selection.setProperties({ type: 'selection' });
    self.scroll = new Point(0, 0);
    self.data.updatePreferredX = true;

    self.language(false);
    self.toggleInsertMode();
    self._initHighlighting();

    var _updateContent = self._updateContent.bind(self);
    self._updateContent = _.throttle(_updateContent, self.options.perf.updateContentThrottle, false);
    self._updateContent();
  }

  async open(givenPath) {
    var self = this;
    await self.ready;
    var params = await Editor.getOpenParams(givenPath);
    self.textBuf.setPath(params.path);
    if (params.exists) await self.textBuf.load();
    self.selection.setHeadPosition(params.position);
    return self;
  }

  async save(filePath) {
    var self = this;
    var args = arguments;
    if (filePath) {
      await self.textBuf.saveAs(util.resolvePath.apply(null, args));
    } else {
      await self.textBuf.save();
    }
    return self.textBuf.getPath();
  }

  static async getOpenParams(givenPath) {
    givenPath = util.resolvePath(givenPath);
    var baseParams = {
      path: givenPath,
      exists: false,
      position: new Point(0, 0)
    };
    var match = givenPath.match(Editor.openRegExp); // always matches
    var candidates = [
      // Try /path/file.c:3:8 first, then /path/file.c:3 line 8, then /path/file.c row 3 col 8
      baseParams,
      _.merge({}, baseParams, {
        path: match[1] + ':' + match[2],
        position: { row: Editor.parseCoordinate(match[3]) }
      }),
      _.merge({}, baseParams, {
        path: match[1],
        position: { row: Editor.parseCoordinate(match[2]), column: Editor.parseCoordinate(match[3]) }
      })
    ];

    var result;
    for (var i = 0; i < candidates.length; i++) {
      var params = candidates[i];
      if ((result || {}).exists) return result;
      params.exists = await Editor.exists(params.path);
      result = params;
    }
    return result;
  }

  static parseCoordinate(n) { return (parseInt(n, 10) - 1) || 0; }

  static async exists(givenPath) {
    try {
      var fd = await fsPromises.open(givenPath, 'r');
      await fd.close();
      return true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return false;
    }
  }

  toggleInsertMode() { return this.insertMode(!this.insertMode()); }

  lineWithEndingForRow(row) {
    var self = this;
    return self.textBuf.lineForRow(row) + self.textBuf.lineEndingForRow(row);
  }

  delete(range) {
    var self = this;
    self.textBuf.delete(range || self.selection.getRange());
    return self;
  }

  _getTabString() {
    var self = this;
    return self.buffer.options.useSpaces
      ? ' '.repeat(self.buffer.options.tabSize)
      : '\t';
  }

  indent(range, dedent) {
    var self = this;

    var tabString = self._getTabString();
    var indentRegex = new RegExp('^(\t| {0,' + self.buffer.options.tabSize + '})', 'g');
    var startDiff = 0, endDiff = 0;
    var linesRange = range.copy();
    linesRange.start.column = 0;
    linesRange.end.column = Infinity;
    self.textBuf.setTextInRange(linesRange, util.text.splitLines(self.textBuf.getTextInRange(linesRange))
      .map(function (line, i) {
        var result = !dedent
          ? tabString + line
          : line.replace(indentRegex, '');
        if (i === 0) startDiff = result.length - line.length;
        if (i === range.getRowCount() - 1) endDiff = result.length - line.length;
        return result;
      })
      .join(''));
    range = range.copy();
    range.start.column += startDiff;
    range.end.column += endDiff;
    self.selection.setRange(range);
    return self;
  }

  visiblePos(pos) {
    var self = this;
    if (pos instanceof Range) return new Range(self.visiblePos(pos.start), self.visiblePos(pos.end));
    pos = Point.fromObject(pos, true);
    pos.column = self.lineWithEndingForRow(pos.row)
      .slice(0, Math.max(pos.column, 0))
      .replace(Editor._tabRegExp, '\t'.repeat(self.buffer.options.tabSize))
      .length;
    return pos;
  }

  realPos(pos) {
    var self = this;
    if (pos instanceof Range) return new Range(self.realPos(pos.start), self.realPos(pos.end));
    pos = Point.fromObject(pos, true);
    pos.column = this.lineWithEndingForRow(self.textBuf.clipPosition(pos).row)
      .replace(Editor._tabRegExp, '\t'.repeat(this.buffer.options.tabSize))
      .slice(0, Math.max(pos.column, 0))
      .replace(new RegExp('\\t{1,' + this.buffer.options.tabSize + '}', 'g'), '\t')
      .length;
    return self.textBuf.clipPosition(pos);
  }

  moveCursorVertical(count, paragraphs) {
    var self = this;
    var selection = self.selection;
    var cursor = selection.getHeadPosition().copy();
    if (count < 0 && cursor.row === 0) {
      selection.setHeadPosition(new Point(0, 0));
    } else if (count > 0 && cursor.row === self.textBuf.getLastRow()) {
      selection.setHeadPosition(new Point(Infinity, Infinity));
    } else {
      if (paragraphs) {
        paragraphs = Math.abs(count);
        var direction = count ? paragraphs / count : 0;
        while (paragraphs--) {
          while (true) {
            cursor.row += direction;

            if (!(0 <= cursor.row && cursor.row < self.textBuf.getLastRow())) break;
            if (/^\s*$/g.test(self.textBuf.lineForRow(cursor.row))) break;
          }
        }
      } else {
        cursor.row += count;
      }

      var x = self.data.preferredCursorX;
      if (typeof x !== 'undefined') cursor.column = self.realPos(new Point(cursor.row, x)).column;
      self.data.updatePreferredX = false;
      selection.setHeadPosition(cursor);
      self.data.updatePreferredX = true;
    }

    return self;
  }

  moveCursorHorizontal(count, words) {
    var self = this;
    var selection = self.selection;

    if (words) {
      words = Math.abs(count);
      var direction = words / count;
      while (words--) {
        var cursor = selection.getHeadPosition();
        var line = self.textBuf.lineForRow(cursor.row);
        var wordMatch = word[direction === -1 ? 'prev' : 'current'](line, cursor.column);
        self.moveCursorHorizontal(direction * Math.max(1, {
          '-1': cursor.column - (wordMatch ? wordMatch.index : 0),
          '1': (wordMatch ? wordMatch.index + wordMatch[0].length : line.length) - cursor.column
        }[direction]));
      }
    } else {
      var cursor = selection.getHeadPosition().copy();
      while (true) {
        if (-count > cursor.column) {
          count += cursor.column + 1;
          if (cursor.row > 0) {
            cursor.row -= 1;
            cursor.column = self.textBuf.lineForRow(cursor.row).length;
          }
        } else {
          var restOfLineLength = self.textBuf.lineForRow(cursor.row).length - cursor.column;
          if (count > restOfLineLength) {
            count -= restOfLineLength + 1;
            if (cursor.row < self.textBuf.getLastRow()) {
              cursor.column = 0;
              cursor.row += 1;
            }
          } else {
            cursor.column += count;
            selection.setHeadPosition(cursor);
            break;
          }
        }
      }
    }

    return self;
  }

  async copy() {
    var self = this;
    var text = self.textBuf.getTextInRange(self.selection.getRange());
    if (!text) return self;
    self.screen.data.clipboard = text;
    self.screen.copyToClipboard(text);
    try {
      await clipboardCopy(text);
    } catch (err) {
      util.logger.warn('Editor#copy', err);
    }
    util.logger.debug('copied ' + text.length + ' characters');
    return self;
  }

  async paste() {
    var self = this;
    var text;
    try {
      text = await clipboardPaste();
    } catch (err) {
      util.logger.warn('Editor#paste', err);
    }
    text = text || self.screen.data.clipboard;
    if (typeof text === 'string') {
      self.textBuf.setTextInRange(self.selection.getRange(), text);
      self.selection.reversed = false;
      self.selection.clearTail();
      util.logger.debug('pasted ' + text.length + ' characters');
    }
    return self;
  }

  matchingBracket(pos) {
    var self = this;

    pos = pos || self.selection.getHeadPosition();
    var bracket = (self.lineWithEndingForRow(pos.row)[pos.column] || '').match(Editor._bracketsRegExp);
    if (!bracket) return;
    var start = !!bracket[1];
    var _half = (bracket.length - 3) / 2 + 1;
    function oppositeBracketMatchIndex(bracketMatch) {
      var matchIndex;
      bracketMatch.some(function (match, i) {
        if ([0, 1, _half + 1].indexOf(i) === -1 && match) {
          matchIndex = i + _half * (start ? 1 : -1);
          return true;
        }
      });
      return matchIndex;
    }

    var lines = util.text.splitLines(self.textBuf.getTextInRange(start
      ? new Range(pos, new Point(Infinity, Infinity))
      : new Range(new Point(0, 0), new Point(pos.row, pos.column + 1))));

    if (!start) lines.reverse();

    var matches = [];
    var result = false;
    lines.some(function (line, row) {
      var column = start ? -1 : Infinity;
      while (true) {
        column = start
          ? util.text.regExpIndexOf(line, Editor._bracketsRegExp, column + 1)
          : util.text.regExpLastIndexOf(line.slice(0, column), Editor._bracketsRegExp);
        if (column === -1) break;
        var match = line[column].match(Editor._bracketsRegExp);
        if (!!match[1] === start) {
          matches.push(match);
        } else {
          var isOppositeBracket = !!match[oppositeBracketMatchIndex(matches.pop())];
          if (!matches.length || !isOppositeBracket) {
            result = {
              column: column + (start && row === 0 && pos.column),
              row: pos.row + (start ? row : -row),
              match: isOppositeBracket
            };
            return true;
          }
        }
      }
    });
    return result;
  }

  _requestHighlight() {
    var self = this;
    if (self.options.highlight) {
      var highlight = self.data.highlight;
      highlight.revision++;
      Editor.highlightClient.then(function (client) {
        if (client && !client.dontRespawn) {
          client.send({
            type: 'highlight',
            text: self.textBuf.getText(),
            language: self.language(),
            revision: highlight.revision,
            bucket: highlight.bucket
          });
        }
      });
    }
  }

  _initHighlighting() {
    var self = this;

    self.data.highlight = { ranges: [], revision: 0, bucket: highlightClient.getBucket() };

    if (!Editor.count++) {
      Editor.highlightClient = highlightClient().then(function (client) {
        var loggerOpts = self.options.logger;
        if (loggerOpts) client.send({ type: 'logger', options: loggerOpts });
        return client;
      });
    }

    self.on('detach', function () {
      if (--Editor.count) return;
      Editor.highlightClient.then(function (client) {
        if (!client) return;
        client.dontRespawn = true;
        client.kill();
      }).catch(function () {});
      self._updateCursor();
    });

    Editor.highlightClient.then(function (client) {
      self.on('language', function () { self._requestHighlight(); });
      self.textBuf.onDidChange(function () { self._requestHighlight(); });
      function highlight(data) {
        if (self.isAttached()) client.once('message', highlight);
        if (data.bucket === self.data.highlight.bucket && data.revision >= self.data.highlight.revision) {
          self.destroyMarkers({ type: 'syntax' });
          self.data.highlight = data;
          self.data.highlight.ranges.forEach(function (range) {
            self.textBuf.markRange(range.range, range.properties);
          });
          self._updateContent();
        }
      }
      client.once('message', highlight);
    }).catch(function () {});

    return self;
  }

  clipScroll(poss) {
    var self = this;

    var size = self.buffer.size();
    var scroll = (poss || []).reduce(function (scroll, pos) {
      var cursorPadding = self.buffer.options.cursorPadding || {};
      var minScroll = pos.translate(size.negate())
        .translate(new Point((cursorPadding.right || 0) + 1, (cursorPadding.bottom || 0) + 1));
      var maxScroll = pos
        .translate(new Point(-cursorPadding.left || 0, -cursorPadding.top || 0));

      return new Point(
        Math.min(Math.max(scroll.row, minScroll.row), maxScroll.row),
        Math.min(Math.max(scroll.column, minScroll.column), maxScroll.column));
    }, self.scroll);

    self.scroll = new Point(
      Math.max(0, Math.min(scroll.row, self.textBuf.getLineCount() - size.row)),
      Math.max(0, scroll.column));
    self._updateContent();

    return self;
  }

  _markMatches() {
    var self = this;
    var selection = self.selection.getRange();
    var selectionText = self.textBuf.getTextInRange(selection);
    var line = self.lineWithEndingForRow(selection.end.row);

    self.destroyMarkers({ type: 'match' });
    if (selection.isSingleLine() && selectionText.match(/^[\w.-]+$/)
      && (line[selection.start.column - 1] || ' ').match(/\W/)
      && (line[selection.end.column] || ' ').match(/\W/)) {
      self.textBuf.scan(new RegExp('\\b' + _.escapeRegExp(selectionText) + '\\b', 'g'), function (match) {
        self.textBuf.markRange(match.range, { type: 'match' });
      });
    }
    return self;
  }

  _initHandlers() {
    var self = this;

    var selection = self.selection;

    self.on('keypress', function (ch, key) {
      var selectionRange = selection.getRange().copy();
      var binding = self.resolveBinding(key);
      if (self.options.multiLine
        && binding === 'indent'
        && key.full === 'tab'
        && selectionRange.isSingleLine()) binding = false;

      if (binding && ['go', 'select', 'delete'].some(function (action) {
        if (binding.indexOf(action) === 0) {
          if (action !== 'go') selection.plantTail();
          var directionDistance = binding.slice(action.length);
          return [
            { name: 'All' },
            { name: 'MatchingBracket' },
            { name: 'Left', axis: 'horizontal', direction: -1 },
            { name: 'Right', axis: 'horizontal', direction: 1 },
            { name: 'Up', axis: 'vertical', direction: -1 },
            { name: 'Down', axis: 'vertical', direction: 1 }
          ].some(function (direction) {
            if (directionDistance.indexOf(direction.name) === 0) {
              var moved = true;

              if (direction.name === 'All') {
                selection.setRange(self.textBuf.getRange());
              } else if (direction.name === 'MatchingBracket') {
                var matchingBracket = self.matchingBracket();
                if (matchingBracket) selection.setHeadPosition(matchingBracket);
                else moved = false;
              } else {
                var selectionDirection = -(!selection.getRange().isEmpty() && selection.isReversed() * 2 - 1);
                if (!(action === 'delete' && (selectionDirection || self.readOnly()))) {
                  var distance = directionDistance.slice(direction.name.length);
                  switch (direction.axis) {
                    case 'horizontal':
                      switch (distance) {
                        case '':
                          if (action === 'go' && direction.direction === -selectionDirection) {
                            selection.setHeadPosition(selection.getTailPosition());
                          } else {
                            self.moveCursorHorizontal(direction.direction);
                          }
                          break;
                        case 'Word': self.moveCursorHorizontal(direction.direction, true); break;
                        case 'Infinity':
                          var cursor = selection.getHeadPosition();
                          var firstNonWhiteSpaceX = (self.lineWithEndingForRow(cursor.row).match(/^\s*/) || [''])[0].length;
                          selection.setHeadPosition(new Point(cursor.row, direction.direction === -1
                            ? cursor.column === firstNonWhiteSpaceX
                              ? 0
                              : firstNonWhiteSpaceX
                            : Infinity));
                          break;
                        default: moved = false; break;
                      }
                      break;
                    case 'vertical':
                      switch (distance) {
                        case '': self.moveCursorVertical(direction.direction); break;
                        case 'Paragraph': self.moveCursorVertical(direction.direction, true); break;
                        case 'Page': self.moveCursorVertical(direction.direction * self.options.pageLines); break;
                        case 'Infinity':
                          selection.setHeadPosition(direction.direction === -1
                            ? new Point(0, 0)
                            : new Point(Infinity, Infinity));
                          break;
                        default: moved = false; break;
                      }
                  }
                }
              }
              if (moved) {
                if (action === 'go') selection.clearTail();
                if (action === 'delete' && !self.readOnly()) self.delete();
                return true;
              }
            }
          });
        }
      })) {
        return false;
      } else {
        switch (binding) {
          case 'selectLine':
          case 'deleteLine':
            var cursor = selection.getHeadPosition();
            selection.setRange(new Range(
              cursor.row === self.textBuf.getLineCount() - 1
                ? new Point(cursor.row - 1, Infinity)
                : new Point(cursor.row, 0),
              new Point(cursor.row + 1, 0)));
            if (binding === 'deleteLine') self.delete();
            selection.setHeadPosition(cursor);
            return false;
          case 'indent':
          case 'dedent':
            if (!self.options.multiLine) return;
            self.indent(selectionRange, binding === 'dedent'); return false;
          case 'duplicateLine':
            var cursorDup = selection.getHeadPosition();
            var lineDup = self.lineWithEndingForRow(cursorDup.row);
            if (lineDup === self.textBuf.lineForRow(cursorDup.row)) lineDup = '\n' + lineDup;
            var nextLinePos = new Point(cursorDup.row + 1, 0);
            self.textBuf.setTextInRange(new Range(nextLinePos, nextLinePos), lineDup);
            return false;
          case 'undo': self.textBuf.undo(); return false;
          case 'redo': self.textBuf.redo(); return false;
          case 'copy':
          case 'cut':
            self.copy().catch(function () {});
            if (binding === 'cut') self.delete();
            return false;
          case 'paste': self.paste().catch(function () {}); return false;
          case 'toggleInsertMode': self.toggleInsertMode(); return false;
          default:
            if (!binding && !key.ctrl && ch) {
              var enterPressed = key.name === 'return' || key.name === 'linefeed';
              var cursorIns = selection.getHeadPosition();
              var lineIns = self.lineWithEndingForRow(cursorIns.row);
              if (enterPressed) {
                if (!self.options.multiLine) return;
                ch = '\n' + lineIns.slice(0, cursorIns.column).match(/^( |\t)*/)[0];
              } else if (key.name === 'enter') {
                return; // blessed remaps keys -- ch and key.sequence here are '\r'
              } else if (ch === '\t') {
                ch = self._getTabString();
              } else if (ch === '\x1b') { // escape
                return;
              }

              if (!self.readOnly()) {
                if (selectionRange.isEmpty() && !self.insertMode() && !enterPressed) selectionRange.end.column++;
                selection.setRange(self.textBuf.setTextInRange(selectionRange, ch));
                selection.reversed = false;
                selection.clearTail();
              }
              return false;
            }
            break;
        }
      }
    });

    self.on('mouse', function (mouseData) {
      process.nextTick(function () { self._lastMouseData = mouseData; });
      if (mouseData.action === 'wheeldown' || mouseData.action === 'wheelup') {
        self.scroll.row += {
          wheelup: -1,
          wheeldown: 1
        }[mouseData.action] * self.options.pageLines;
        self.clipScroll();
        return;
      }

      var mouse = self.realPos(new Point(mouseData.y, mouseData.x)
        .translate(self.buffer.pos().negate())
        .translate(self.scroll));

      var newSelection = selection.copy();
      if (mouseData.action === 'mouseup') self.data.lastClick = { mouse: mouse, time: Date.now() };
      if (mouseData.action === 'mousedown') {
        var lastClick = self.data.lastClick;
        if (lastClick && mouse.isEqual(lastClick.mouse) && lastClick.time + self.options.doubleClickDuration > Date.now()) {
          self.data.lastClick = null;
          var line = self.textBuf.lineForRow(mouse.row);
          var startX = mouse.column;
          var endX = mouse.column + 1;
          var prev = word.prev(line, mouse.column);
          var current = word.current(line, mouse.column);
          if (current) {
            if (prev && current.index < prev.index + prev[0].length) {
              startX = prev.index;
              endX = prev.index + prev[0].length;
            } else if (current.index <= mouse.column && mouse.column < current.index + current[0].length) {
              startX = current.index;
              endX = current.index + current[0].length;
            }
          }
          newSelection.setRange(new Range(new Point(mouse.row, startX), new Point(mouse.row, endX)));
        } else {
          if ((self._lastMouseData || {}).action !== 'mousedown' && !mouseData.shift) newSelection.clearTail();
          newSelection.setHeadPosition(mouse);
          newSelection.plantTail();
        }
      }
      selection.setRange(newSelection.getRange(), { reversed: newSelection.isReversed() });
      newSelection.destroy();
    });

    self.textBuf.onDidChangePath(function () { self.language(extname(self.textBuf.getPath()).slice(1)); });

    selection.onDidChange(function () {
      var cursor = self.visiblePos(selection.getHeadPosition());
      if (self.data.updatePreferredX) self.data.preferredCursorX = cursor.column;
      self._markMatches();
      self.clipScroll([cursor]);
    });

    self.textBuf.onDidChange(function () { self._updateContent(); });

    self.on('detach', function () { self.textBuf.destroy(); });

    return BaseWidget.prototype._initHandlers.apply(self, arguments);
  }

  _updateCursor() {
    var self = this;
    if (!self.visible) {
      self.screen.program.hideCursor();
      return;
    }
    var scrollCursor = self.visiblePos(self.selection.getHeadPosition()).translate(self.scroll.negate());
    if (new Range(new Point(0, 0), self.buffer.size().translate(new Point(-1, -1))).containsPoint(scrollCursor) && self === self.screen.focused) {
      var screenCursor = scrollCursor.translate(self.buffer.pos());
      self.screen.program.move(screenCursor.column, screenCursor.row);
      self.screen.program.showCursor();
    } else {
      self.screen.program.hideCursor();
    }
  }

  destroyMarkers(params) {
    var self = this;
    self.textBuf.findMarkers(params).forEach(function (marker) {
      marker.destroy();
    });
    return self;
  }

  _renderableTabString(match) {
    return !this.buffer.options.visibleWhiteSpace
      ? ' '.repeat(this.buffer.options.tabSize * match.length)
      : util.markup(
          (
            '\u2500'.repeat(this.buffer.options.tabSize - 1) +
            (this.buffer.options.tabSize ? '\u2574' : '')
          ).repeat(match.length),
          this.options.style.whiteSpace
        );
  }

  _renderableSpace(match) {
    return !this.buffer.options.visibleWhiteSpace
      ? match
      : util.markup('\u00b7'.repeat(match.length), this.options.style.whiteSpace);
  }

  _renderableLineEnding(lineEnding) {
    return !this.buffer.options.visibleLineEndings
      ? ''
      : util.markup(
          lineEnding.replace(/\n/g, '\\n').replace(/\r/g, '\\r'),
          this.options.style.whiteSpace
        );
  }

  _updateContent() {
    var self = this;

    var size = self.buffer.size();
    var scroll = self.scroll;
    var selectionRange = self.selection.getRange();
    var matchingBracket = self.matchingBracket(self.selection.getHeadPosition());
    var cursorOnBracket = selectionRange.isEmpty() && matchingBracket !== undefined;
    var visibleSelection = self.visiblePos(selectionRange);
    var visibleCursor = visibleSelection[selectionRange.reversed ? 'start' : 'end'];
    var visibleMatchingBracket = selectionRange.isEmpty() && matchingBracket && self.visiblePos(matchingBracket);

    var style = self.options.style;
    var defaultStyle = style.default;
    var selectionStyle = style.selection;
    var matchStyle = style.match;
    var bracketStyle = matchingBracket && matchingBracket.match ? style.matchingBracket : style.mismatchedBracket;

    var gutterWidth = self.gutter.width;
    var lineNumberWidth = self.gutter.options.lineNumberWidth || 0;
    var currentLineStyle = self.gutter.options.style.currentLine;

    var bufferContent = [];
    var gutterContent = [];

    util.text.splitLines(BaseWidget.blessed.escape(self.textBuf.getTextInRange({
      start: new Point(scroll.row, 0),
      end: scroll.translate(size)
    }))).forEach(function (line, row) {
      var column = scroll.column;
      row += scroll.row;

      var renderableLineEnding = self._renderableLineEnding((line.match(util.text._lineRegExp) || [''])[0]);
      line = line
        .replace(/\t+/g, self._renderableTabString.bind(self))
        .replace(/ +/g, self._renderableSpace.bind(self))
        .replace(util.text._lineRegExp, renderableLineEnding)
        .replace(Editor._nonprintableRegExp, '\ufffd');

      line = util.markup.parse(line)
        .slice(column, column + size.column)
        .push(' '.repeat(size.column))
        .tag(defaultStyle);

      self.textBuf.findMarkers({ intersectsRow: row }).sort(Editor.markerCmp).forEach(function (marker) {
        var range = self.visiblePos(marker.getRange());
        if (range.intersectsRow(row)) {
          var markerStyle;
          switch (marker.properties.type) {
            case 'selection': markerStyle = selectionStyle; break;
            case 'match': case 'findMatch': markerStyle = matchStyle; break;
            case 'syntax': markerStyle = marker.properties.syntax
              .map(function (syntax) {
                if (!(syntax in style)) util.logger.debug('unstyled syntax:', syntax);
                return style[syntax] || '';
              })
              .join(''); break;
            default: throw new Error('unknown marker: ' + marker.properties.type);
          }
          line = util.markup(line, markerStyle,
            row === range.start.row ? range.start.column - column : 0,
            row === range.end.row ? range.end.column - column : Infinity);
        }
      });

      if (cursorOnBracket && row === visibleCursor.row) {
        line = util.markup(line, bracketStyle,
          visibleCursor.column - column,
          visibleCursor.column - column + 1);
      }
      if (visibleMatchingBracket && row === visibleMatchingBracket.row) {
        line = util.markup(line, bracketStyle,
          visibleMatchingBracket.column - column,
          visibleMatchingBracket.column - column + 1);
      }

      bufferContent.push(line + '{/}');

      // Optional per-line git diff indicator. Consumes one column of the
      // gutter when self.gitDiff is set (Sets of 0-indexed rows for added,
      // modified, and deletedAtRow). The indicator is kept inside the
      // existing gutterWidth budget (we render lineNumberWidth digits, then
      // the marker char, then pad out to gutterWidth) so the gutter shape
      // doesn't shift when diff data appears or disappears.
      var diff = self.gitDiff;
      var gitStyles = self.options.style.git || {};
      var marker = ' ';
      if (diff) {
        if (diff.added && diff.added.has(row)) {
          marker = util.markup('\u2503', gitStyles.added || '{green-fg}{bold}').toString();
        } else if (diff.modified && diff.modified.has(row)) {
          marker = util.markup('\u2503', gitStyles.modified || '{yellow-fg}{bold}').toString();
        } else if (diff.deletedAtRow && diff.deletedAtRow.has(row)) {
          marker = util.markup('\u2581', gitStyles.deleted || '{red-fg}{bold}').toString();
        }
      }
      var padCount = Math.max(0, gutterWidth - 1);
      var gutterLine = String(row + 1).padStart(lineNumberWidth, ' ') + marker + ' '.repeat(padCount);

      if (currentLineStyle && row === visibleCursor.row) {
        gutterLine = util.markup(gutterLine, currentLineStyle);
      }

      gutterContent.push(gutterLine + '{/}');
    });

    self.buffer.setContent(bufferContent.join('\n'));
    self.gutter.setContent(gutterContent.join('\n'));
    self.screen.render();
  }
}

// Looks for path like /home/dan/file.c:3:8 but matches every string
Editor.openRegExp = new RegExp('^'
  + '(.*?)'           // path:   match[1] (like /home/dan/file.c)
  + '(?:\\:(\\d+))?'  // row:    match[2] (like 3, optional)
  + '(?:\\:(\\d+))?'  // column: match[3] (like 8, optional)
  + '$');

Editor._tabRegExp = /\t/g;
Editor._bracketsRegExp = /((\()|(\[)|(\{))|((\))|(\])|(\}))/;
Editor._nonprintableRegExp = /[\x00-\x1f]|\x7f/g;
Editor.MARKER_ORDER = ['syntax', 'match', 'findMatch', 'selection'];
Editor.markerCmp = function (a, b) {
  return Editor.MARKER_ORDER.indexOf(b.properties.type) - Editor.MARKER_ORDER.indexOf(a.properties.type);
};
Editor.count = 0;

Editor.prototype.insertMode = util.getterSetter('insertMode', null, Boolean);
Editor.prototype.language = util.getterSetter('language', null, null);
Editor.prototype.readOnly = util.getterSetter('readOnly', null, Boolean);

module.exports = Editor;
Editor.Field = require('./Field');
