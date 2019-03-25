// tslint:disable:object-literal-sort-keys

import * as ayu from 'ayu';

export const theme = ayu.dark;

const bordered = false;

// Source: https://github.com/ayu-theme/vscode-ayu/blob/master/src/template.ts

export const colors = {
  // BASE COLOURS
  focusBorder: theme.common.ui.fade(0.4).hex(),
  foreground: theme.common.ui.hex(),
  'widget.shadow': theme.ui.panel.shadow.hex(),
  'selection.background': theme.ui.selection.bg.alpha(0.992).hex(),

  // TEXT COLOURS
  'textBlockQuote.background': theme.ui.panel.bg.hex(),
  'textLink.foreground': theme.common.accent.hex(),
  'textLink.activeForeground': theme.common.accent.hex(),
  'textPreformat.foreground': theme.common.fg.hex(),

  // BUTTON CONTROL
  'button.background': theme.common.accent.hex(),
  'button.foreground': theme.common.bg.fade(0.5).hex(),
  'button.hoverBackground': theme.common.accent.darken(0.1).hex(),

  // DROPDOWN CONTROL
  'dropdown.background': theme.ui.panel.bg.hex(),
  'dropdown.foreground': theme.common.ui.hex(),
  'dropdown.border': theme.common.ui.fade(0.7).hex(),

  // INPUT CONTROL
  'input.background': theme.ui.panel.bg.hex(),
  'input.border': theme.common.ui.fade(0.7).hex(),
  'input.foreground': theme.common.fg.hex(),
  'input.placeholderForeground': theme.common.ui.fade(0.3).hex(),
  'inputOption.activeBorder': theme.common.accent.hex(),
  'inputValidation.errorBackground': theme.common.bg.hex(),
  'inputValidation.errorBorder': theme.syntax.error.hex(),
  'inputValidation.infoBackground': theme.common.bg.hex(),
  'inputValidation.infoBorder': theme.syntax.tag.hex(),
  'inputValidation.warningBackground': theme.common.bg.hex(),
  'inputValidation.warningBorder': theme.syntax.func.hex(),

  // SCROLLBAR CONTROL
  'scrollbar.shadow': theme.ui.line.hex(),
  'scrollbarSlider.background': theme.common.ui.alpha(0.4).hex(),
  'scrollbarSlider.hoverBackground': theme.common.ui.alpha(0.6).hex(),
  'scrollbarSlider.activeBackground': theme.common.ui.alpha(0.7).hex(),

  // BADGE
  'badge.background': theme.common.accent.hex(),
  'badge.foreground': theme.common.bg.hex(),

  // PROGRESS BAR
  'progressBar.background': theme.common.accent.hex(),

  // EDITOR
  'editor.background': bordered
    ? theme.ui.panel.bg.hex()
    : theme.common.bg.hex(),
  'editor.foreground': theme.common.fg.hex(),
  'editorLineNumber.foreground': theme.ui.gutter.normal.hex(),
  'editorLineNumber.activeForeground': theme.ui.gutter.active.hex(),
  'editorCursor.foreground': theme.common.accent.hex(),

  'editor.selectionBackground': theme.ui.selection.bg.hex(),
  'editor.inactiveSelectionBackground': theme.ui.selection.inactive.hex(),
  'editor.selectionHighlightBackground': theme.ui.selection.inactive.hex(),
  'editor.selectionHighlightBorder': theme.ui.selection.border.hex(),

  'editor.wordHighlightBackground': theme.ui.selection.inactive.hex(),
  'editor.wordHighlightStrongBackground': theme.common.accent.alpha(0.2).hex(),

  'editor.findMatchBackground': theme.common.accent.alpha(0.05).hex(),
  'editor.findMatchBorder': theme.common.accent.hex(),
  'editor.findMatchHighlightBackground': theme.common.accent.alpha(0.05).hex(),
  'editor.findMatchHighlightBorder': theme.common.accent.alpha(0.35).hex(),
  'editor.findRangeHighlightBackground': theme.ui.selection.inactive.hex(),
  'editor.findRangeHighlightBorder': `${theme.common.bg.hex()}00`,

  'editor.lineHighlightBackground': theme.ui.line.hex(),

  'editorLink.activeForeground': theme.common.accent.hex(),

  'editor.rangeHighlightBackground': theme.ui.line.hex(),

  'editorWhitespace.foreground': theme.ui.gutter.normal.hex(),

  'editorIndentGuide.background': theme.ui.guide.normal.hex(),
  'editorIndentGuide.activeBackground': theme.ui.guide.active.hex(),

  'editorRuler.foreground': theme.ui.guide.normal.hex(),
  'editorCodeLens.foreground': theme.syntax.comment.hex(),

  'editorBracketMatch.background': theme.ui.gutter.normal.alpha(0.3).hex(),
  'editorBracketMatch.border': theme.ui.gutter.active.alpha(0.6).hex(),

  // OVERVIEW RULER
  'editorOverviewRuler.border': theme.ui.line.hex(),
  'editorOverviewRuler.modifiedForeground': theme.vcs.modified.alpha(0.6).hex(),
  'editorOverviewRuler.addedForeground': theme.vcs.added.alpha(0.6).hex(),
  'editorOverviewRuler.deletedForeground': theme.vcs.removed.alpha(0.6).hex(),
  'editorOverviewRuler.errorForeground': theme.syntax.error.hex(),
  'editorOverviewRuler.warningForeground': theme.common.accent.hex(),

  // ERRORS AND WARNINGS
  'editorError.foreground': theme.syntax.error.hex(),
  'editorWarning.foreground': theme.common.accent.hex(),

  // GUTTER
  'editorGutter.modifiedBackground': theme.vcs.modified.alpha(0.6).hex(),
  'editorGutter.addedBackground': theme.vcs.added.alpha(0.6).hex(),
  'editorGutter.deletedBackground': theme.vcs.removed.alpha(0.6).hex(),

  // EDITOR WIDGET
  'editorWidget.background': theme.ui.panel.bg.hex(),
  'editorSuggestWidget.background': theme.ui.panel.bg.hex(),
  'editorSuggestWidget.border': theme.ui.panel.border.hex(),
  'editorSuggestWidget.highlightForeground': theme.common.accent.hex(),
  'editorSuggestWidget.selectedBackground': theme.ui.line.hex(),
  'editorHoverWidget.background': theme.ui.panel.bg.hex(),
  'editorHoverWidget.border': theme.ui.panel.border.hex(),

  // DEBUG EXCEPTION
  'debugExceptionWidget.border': theme.ui.line.hex(),
  'debugExceptionWidget.background': theme.ui.panel.bg.hex(),

  // EDITOR MARKER
  'editorMarkerNavigation.background': theme.ui.panel.bg.hex(),

  // PEEK VIEW
  'peekView.border': theme.ui.line.hex(),
  'peekViewEditor.background': theme.ui.panel.bg.hex(),
  'peekViewEditor.matchHighlightBackground': theme.common.accent
    .alpha(0.2)
    .hex(),
  'peekViewResult.background': theme.ui.panel.bg.hex(),
  'peekViewResult.fileForeground': theme.common.ui.hex(),
  'peekViewResult.matchHighlightBackground': theme.common.accent
    .alpha(0.2)
    .hex(),
  'peekViewTitle.background': theme.ui.panel.bg.hex(),
  'peekViewTitleDescription.foreground': theme.common.ui.hex(),
  'peekViewTitleLabel.foreground': theme.common.ui.hex(),

  // Panel
  'panel.background': theme.common.bg.hex(),
  'panel.border': theme.ui.line.hex(),
  'panelTitle.activeBorder': theme.common.accent.hex(),
  'panelTitle.activeForeground': theme.common.fg.hex(),
  'panelTitle.inactiveForeground': theme.common.ui.hex(),

  // STATUS BAR
  'statusBar.background': theme.common.bg.hex(),
  'statusBar.foreground': theme.common.ui.hex(),
  'statusBar.border': bordered ? theme.ui.line.hex() : theme.common.bg.hex(),
  'statusBar.debuggingBackground': theme.syntax.operator.hex(),
  'statusBar.debuggingForeground': theme.common.bg.fade(0.5).hex(),
  'statusBar.noFolderBackground': theme.ui.panel.bg.hex(),
  'statusBarItem.activeBackground': '#00000050',
  'statusBarItem.hoverBackground': '#00000030',
  'statusBarItem.prominentBackground': theme.ui.line.hex(),
  'statusBarItem.prominentHoverBackground': '#00000030',
};
