import { Disposable, Position, Range, workspace } from 'coc.nvim';
import { InternalVimEvents } from '../events';
import type { Explorer } from '../explorer';
import { HighlightCommand, HighlightPositionWithLine } from './types';

class HighlightManager {
  nvim = workspace.nvim;
  highlights: HighlightCommand[] = [];

  /**
   * Link highlight group to another one
   */
  linkGroup(groupName: string, targetGroup: string): HighlightCommand {
    const group = `CocExplorer${groupName}`;
    const commands = [`highlight default link ${group} ${targetGroup}`];
    const highlight = {
      group,
      commands,
    };
    this.highlights.push(highlight);
    return highlight;
  }

  /**
   * Create a new highlight group
   */
  createGroup(groupName: string, hlCommand: string): HighlightCommand {
    const group = `CocExplorer${groupName}`;
    const commands = [`highlight default ${group} ${hlCommand}`];
    const highlight = {
      group,
      commands,
    };
    this.highlights.push(highlight);
    return highlight;
  }

  async watchColorScheme(
    disposables: Disposable[],
    update: () => void | Promise<void>,
    immediate = true,
  ) {
    disposables.push(InternalVimEvents.events.on('ColorScheme', update));
    if (immediate) {
      await update();
    }
  }

  clearHighlightsNotify(
    explorer: Explorer,
    hlSrcId: number,
    lineStart?: number,
    lineEnd?: number,
  ) {
    explorer.buffer.clearNamespace(hlSrcId, lineStart, lineEnd);
  }

  addHighlightsNotify(
    explorer: Explorer,
    hlSrcId: number,
    highlights: HighlightPositionWithLine[],
  ) {
    for (const hl of highlights) {
      if (hl.size === 0) {
        continue;
      }
      explorer.buffer.highlightRanges(hlSrcId, hl.group, [
        Range.create(
          Position.create(hl.lineIndex, hl.start),
          Position.create(hl.lineIndex, hl.start + hl.size),
        ),
      ]);
    }
  }

  bootHighlightSyntaxNotify() {
    const commands: string[] = [];
    for (const hl of this.highlights) {
      this.nvim.command(`silent! syntax clear ${hl.group}`, true);
      commands.push(...hl.commands);
    }
    this.nvim.call('coc_explorer#util#execute_commands', [commands], true);
  }
}

export const hlGroupManager = new HighlightManager();
