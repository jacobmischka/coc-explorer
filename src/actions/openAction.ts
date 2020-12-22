import { WinLayoutFinder } from 'coc-helper';
import { workspace } from 'coc.nvim';
import { argOptions } from '../argOptions';
import type { Explorer } from '../explorer';
import { ArgPosition } from '../parseArgs';
import { BaseTreeNode } from '../source/source';
import { OpenStrategy } from '../types';

export async function openAction(
  explorer: Explorer,
  node: BaseTreeNode<any>,
  getFullpath: () => string | Promise<string>,
  {
    openByWinnr: originalOpenByWinnr,
    args = [],
    position,
  }: {
    openByWinnr?: (winnr: number) => void | Promise<void>;
    args?: string[];
    position?: {
      lineIndex: number;
      columnIndex?: number;
    };
  },
) {
  if (node.expandable) {
    return;
  }

  const { nvim } = workspace;

  const getEscapePath = async () => {
    let path = await getFullpath();
    if (explorer.config.get('openAction.relativePath')) {
      path = await nvim.call('fnamemodify', [path, ':.']);
    }
    return await nvim.call('fnameescape', [path]);
  };

  const jumpToNotify = () => {
    if (position) {
      nvim.call(
        'cursor',
        [position.lineIndex + 1, (position.columnIndex ?? 0) + 1],
        true,
      );
    }
  };

  const openByWinnr =
    originalOpenByWinnr ??
    (async (winnr: number) => {
      const quitNotifier = await explorer.tryQuitOnOpenNotifier();
      const escapePath = await getEscapePath();
      nvim.pauseNotification();
      nvim.command(`${winnr}wincmd w`, true);
      nvim.command(`edit ${escapePath}`, true);
      jumpToNotify();
      if (workspace.isVim) {
        // Avoid vim highlight not working,
        // https://github.com/weirongxu/coc-explorer/issues/113
        nvim.command('redraw', true);
      }
      quitNotifier.notify();
      await nvim.resumeNotification();
    });

  const splitIntelligent = async (
    position: ArgPosition,
    command: 'split' | 'vsplit',
    fallbackStrategy: OpenStrategy,
  ) => {
    const explWinid = await explorer.winid;
    if (!explWinid) {
      return;
    }

    const winFinder = await WinLayoutFinder.create();
    const node = winFinder.findWinid(explWinid);
    if (node) {
      if (node.parent && node.parent.group.type === 'row') {
        const target =
          node.parent.group.children[
            node.parent.indexInParent + (position === 'left' ? 1 : -1)
          ];
        if (target) {
          const targetWinid = WinLayoutFinder.getFirstLeafWinid(target);
          const quitNotifier = await explorer.tryQuitOnOpenNotifier();
          const escapePath = await getEscapePath();

          nvim.pauseNotification();
          nvim.call('win_gotoid', [targetWinid], true);
          nvim.command(`${command} ${escapePath}`, true);
          jumpToNotify();
          quitNotifier.notify();
          await nvim.resumeNotification();
        }
      } else {
        // only exlorer window or explorer is arranged in columns
        await actions['vsplit:plain']();
      }
    } else {
      // floating
      await actions[fallbackStrategy]();
    }
  };

  const actions: Record<OpenStrategy, () => void | Promise<void>> = {
    select: async () => {
      const position = await explorer.args.value(argOptions.position);
      if (position === 'floating') {
        await explorer.hide();
      }
      await explorer.selectWindowsUI(
        async (winnr) => {
          await openByWinnr(winnr);
        },
        async () => {
          await actions.vsplit();
        },
        async () => {
          if (position === 'floating') {
            await explorer.show();
          }
        },
      );
    },

    split: () => actions['split:intelligent'](),
    'split:plain': async () => {
      const quitNotifier = await explorer.tryQuitOnOpenNotifier();
      const escapePath = await getEscapePath();
      nvim.pauseNotification();
      nvim.command(`split ${escapePath}`, true);
      jumpToNotify();
      quitNotifier.notify();
      await nvim.resumeNotification();
    },

    'split:intelligent': async () => {
      const position = await explorer.args.value(argOptions.position);
      if (position === 'floating') {
        await actions['split:plain']();
        return;
      } else if (position === 'tab') {
        await actions.vsplit();
        return;
      }
      await splitIntelligent(position, 'split', 'split:plain');
    },

    vsplit: () => actions['vsplit:intelligent'](),
    'vsplit:plain': async () => {
      const quitNotifier = await explorer.tryQuitOnOpenNotifier();
      const escapePath = await getEscapePath();
      nvim.pauseNotification();
      nvim.command(`vsplit ${escapePath}`, true);
      jumpToNotify();
      quitNotifier.notify();
      await nvim.resumeNotification();
    },

    'vsplit:intelligent': async () => {
      const position = await explorer.args.value(argOptions.position);
      if (position === 'floating') {
        await actions['vsplit:plain']();
        return;
      } else if (position === 'tab') {
        await actions['vsplit:plain']();
        return;
      }
      await splitIntelligent(position, 'vsplit', 'vsplit:plain');
    },

    tab: async () => {
      await explorer.tryQuitOnOpen();
      nvim.pauseNotification();
      nvim.command(`tabedit ${await getEscapePath()}`, true);
      jumpToNotify();
      await nvim.resumeNotification();
    },

    previousBuffer: async () => {
      const prevWinnr = await explorer.explorerManager.prevWinnrByPrevBufnr();
      if (prevWinnr) {
        await openByWinnr(prevWinnr);
      } else {
        await actions.vsplit();
      }
    },

    previousWindow: async () => {
      const prevWinnr = await explorer.explorerManager.prevWinnrByPrevWindowID();
      if (prevWinnr) {
        await openByWinnr(prevWinnr);
      } else {
        await actions.vsplit();
      }
    },

    sourceWindow: async () => {
      const srcWinnr = await explorer.sourceWinnr();
      if (srcWinnr) {
        await openByWinnr(srcWinnr);
      } else {
        await actions.vsplit();
      }
    },
  };

  let openStrategy = await explorer.args.value(argOptions.openActionStrategy);
  if (args.length) {
    openStrategy = args.join(':') as OpenStrategy;
  }
  if (!(openStrategy in actions)) {
    new Error(`openStrategy(${openStrategy}) is not supported`);
  }
  await actions[openStrategy]();
}
