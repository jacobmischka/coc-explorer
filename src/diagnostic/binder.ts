import { Disposable } from 'coc.nvim';
import pathLib from 'path';
import { internalEvents } from '../events';
import { BaseTreeNode, ExplorerSource } from '../source/source';
import {
  Cancelled,
  debouncePromise,
  logger,
  mapGetWithDefault,
  sum,
  throttle,
} from '../util';
import { diagnosticManager, DiagnosticType } from './manager';

export class DiagnosticBinder {
  protected sourcesBinding: Map<
    ExplorerSource<BaseTreeNode<any>>,
    {
      refCount: {
        [key in DiagnosticType | 'total']: number;
      };
    }
  > = new Map();
  private prevErrorMixedCount: Map<string, number> = new Map();
  private prevWarningMixedCount: Map<string, number> = new Map();
  private registeredDisposable?: Disposable;
  private registeredForSourceDisposable?: Disposable;

  get sources() {
    return [...this.sourcesBinding.keys()];
  }

  get refTotalCount() {
    return sum([...this.sourcesBinding.values()].map((b) => b.refCount.total));
  }

  get diagnosticTypes() {
    const types: DiagnosticType[] = [];
    const refs = [...this.sourcesBinding.values()].map((ref) => ref.refCount);
    if (refs.some((ref) => ref.error > 0)) {
      types.push('error');
    }
    if (refs.some((ref) => ref.warning > 0)) {
      types.push('warning');
    }
    return types;
  }

  bind(source: ExplorerSource<any>, type: DiagnosticType) {
    const binding = mapGetWithDefault(this.sourcesBinding, source, () => ({
      refCount: {
        error: 0,
        warning: 0,
        total: 0,
      },
    }));
    binding.refCount[type] += 1;
    binding.refCount.total += 1;
    if (binding.refCount.total === 1) {
      this.registeredForSourceDisposable = this.registerForSource(source);
    }
    if (this.refTotalCount === 1) {
      this.registeredDisposable = this.register();
    }
    return Disposable.create(() => {
      binding.refCount[type] -= 1;
      binding.refCount.total -= 1;
      if (binding.refCount.total === 0) {
        this.registeredForSourceDisposable?.dispose();
        this.registeredForSourceDisposable = undefined;
      }
      if (this.refTotalCount === 0) {
        this.registeredDisposable?.dispose();
        this.registeredDisposable = undefined;
      }
    });
  }

  protected register() {
    return internalEvents.on(
      'CocDiagnosticChange',
      throttle(100, async () => {
        await this.reload(this.sources);
      }),
    );
  }

  protected registerForSource(source: ExplorerSource<any>) {
    const reload = source.events.on('loaded', async (node) => {
      const directory =
        'isRoot' in node
          ? source.root
          : node.expandable
          ? node.fullpath
          : node.fullpath && pathLib.dirname(node.fullpath);
      if (directory) {
        this.reload([source]).catch(logger.error);
      }
    });

    const updateMark = source.events.on('drawn', () => {
      for (const [nodeIndex, node] of source.view.flattenedNodes.entries()) {
        if (!node.fullpath) {
          continue;
        }
        const errorCount = diagnosticManager.getMixedError(node.fullpath);
        const warningCount = diagnosticManager.getMixedWarning(node.fullpath);
        let errorMark = false;
        let warningMark = false;
        if (errorCount || warningCount) {
          const display = !(node.expandable && source.view.isExpanded(node));
          if (errorCount && display) {
            errorMark = true;
          }
          if (warningCount && display) {
            warningMark = true;
          }
        }
        if (errorMark) {
          source.locator.mark.add('diagnosticError', nodeIndex);
        } else {
          source.locator.mark.remove('diagnosticError', nodeIndex);
        }
        if (warningMark) {
          source.locator.mark.add('diagnosticWarning', nodeIndex);
        } else {
          source.locator.mark.remove('diagnosticWarning', nodeIndex);
        }
      }
    });

    return Disposable.create(() => {
      reload.dispose();
      updateMark.dispose();
    });
  }

  protected reloadDebounceChecker = debouncePromise(1000, () => {});
  protected reloadDebounceArgs = {
    sources: new Set<ExplorerSource<any>>(),
  };
  protected async reloadDebounce(sources: ExplorerSource<any>[]) {
    sources.forEach((s) => {
      this.reloadDebounceArgs.sources.add(s);
    });
    const r = await this.reloadDebounceChecker();
    if (r instanceof Cancelled) {
      return;
    }
    this.reloadDebounceArgs.sources.clear();
  }

  protected async reload(sources: ExplorerSource<any>[]) {
    const types = this.diagnosticTypes;
    diagnosticManager.reload(types);

    const updatePaths: Set<string> = new Set();

    if (types.includes('error')) {
      for (const [fullpath] of this.prevErrorMixedCount) {
        updatePaths.add(fullpath);
      }

      const newErrorMixedCount = new Map(diagnosticManager.getMixedErrors());

      for (const [fullpath] of newErrorMixedCount) {
        updatePaths.add(fullpath);
      }

      this.prevErrorMixedCount = newErrorMixedCount;
    }

    if (types.includes('warning')) {
      for (const [fullpath] of this.prevWarningMixedCount) {
        updatePaths.add(fullpath);
      }

      const newWarningMixedCount = new Map(
        diagnosticManager.getMixedWarnings(),
      );

      for (const [fullpath] of newWarningMixedCount) {
        updatePaths.add(fullpath);
      }

      this.prevWarningMixedCount = newWarningMixedCount;
    }

    for (const source of sources) {
      await source.view.renderPaths(updatePaths);
    }
  }
}
