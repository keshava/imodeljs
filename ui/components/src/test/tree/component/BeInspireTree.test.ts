/*---------------------------------------------------------------------------------------------
* Copyright (c) 2018 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import { expect } from "chai";
import * as moq from "typemoq";
import * as sinon from "sinon";
import * as inspire from "inspire-tree";
import { using } from "@bentley/bentleyjs-core";
import {
  BeInspireTree, BeInspireTreeRenderer, BeInspireTreeNodes, BeInspireTreeNode,
  BeInspireTreeDataProviderMethod, BeInspireTreeNodeConfig,
  MapPayloadToInspireNodeCallback, BeInspireTreeEvent, BeInspireTreeDataProviderInterface,
  toNode,
  BeInspireTreeDataProvider,
} from "../../../tree/component/BeInspireTree";
import { PageOptions } from "../../../common/PageOptions";

interface Node {
  id: string;
  children: Node[];
  autoExpand?: boolean;
}

interface RenderedNode {
  level: number;
  id: string;
  isExpanded?: boolean;
  isSelected?: boolean;
  isChecked?: boolean;
}

describe("BeInspireTree", () => {

  let hierarchy: Node[];
  let tree: BeInspireTree<Node>;
  let renderedTree: RenderedNode[];
  const rendererMock = moq.Mock.ofType<BeInspireTreeRenderer<Node>>();

  const mapImmediateNodeToInspireNodeConfig = (n: Node, remapper: MapPayloadToInspireNodeCallback<Node>): BeInspireTreeNodeConfig => ({
    id: n.id,
    text: n.id,
    itree: {
      state: { collapsed: !n.autoExpand },
    },
    children: n.children.length > 0 ? n.children.map((c) => remapper(c, remapper)) : undefined,
  });

  const mapDelayLoadedNodeToInspireNodeConfig = (n: Node): BeInspireTreeNodeConfig => ({
    id: n.id,
    text: n.id,
    itree: {
      state: { collapsed: !n.autoExpand },
    },
    children: n.children.length > 0 || undefined,
  });

  const createHierarchy = (length: number, depth: number, prefix?: string): Node[] => {
    const nodes: Node[] = [];
    prefix = prefix ? `${prefix}-` : ``;
    for (let i = 0; i < length; ++i) {
      let children: Node[] = [];
      if (depth !== 0)
        children = createHierarchy(length, depth - 1, `${prefix}${i}`);
      nodes.push({ id: `${prefix}${i}`, children });
    }
    return nodes;
  };

  const createDataProviderMethod = (h: Node[]): BeInspireTreeDataProviderMethod<Node> => {
    const map = new Map<string, Node[]>(); // parent id => children
    const fillMap = (parentId: string, list: Node[]) => {
      map.set(parentId, list);
      list.forEach((n) => fillMap(n.id, n.children));
    };
    fillMap("", h);
    return async (parent?: Node): Promise<Node[]> => {
      const parentId = parent ? parent.id : "";
      return map.get(parentId) || [];
    };
  };

  const createDataProviderInterface = (h: Node[]): BeInspireTreeDataProviderInterface<Node> => {
    const m = createDataProviderMethod(h);
    const p = async (nodesPromise: Promise<Node[]>, page?: PageOptions): Promise<Node[]> => {
      const nodes = await nodesPromise;
      if (!page)
        return nodes;
      const end = (page.size !== undefined && page.size !== 0) ? (page.size + (page.start || 0)) : undefined;
      return nodes.slice(page.start, end);
    };
    return {
      getNodesCount: async (parent?: Node) => (await m(parent)).length,
      getNodes: async (parent?: Node, page?: PageOptions) => p(m(parent), page),
    };
  };

  const handleNodeRender = (renderList: RenderedNode[], node: BeInspireTreeNode<Node>) => {
    if (node.available()) {
      if (node.payload) {
        const { autoExpand, children, ...nodeProps } = node.payload;
        renderList.push({
          level: node.getParents().length,
          ...nodeProps,
          isChecked: node.checked(),
          isSelected: node.selected(),
          isExpanded: node.expanded(),
        });
      } else {
        renderList.push({
          level: node.getParents().length,
          id: "<not loaded>",
        });
      }
    }
    node.setDirty(false);
  };

  const flatten = (hierarchicalList: Node[]): Node[] => {
    return hierarchicalList.reduce<Node[]>((flatList: Node[], node: Node): Node[] => {
      return [...flatList, node, ...flatten(node.children)];
    }, []);
  };

  const asText = (n: BeInspireTreeNode<Node>) => n.text;

  const loadHierarchy = async (h: inspire.TreeNode[] | inspire.TreeNodes) => {
    await using(tree.pauseRendering(), async () => {
      await Promise.all(h.map(async (n) => {
        if (!n.hasOrWillHaveChildren())
          return;
        const children = await n.loadChildren();
        if (children.length !== 0)
          await loadHierarchy(children);
      }));
    });
  };

  beforeEach(() => {
    hierarchy = createHierarchy(2, 2);
    renderedTree = [];
    rendererMock.reset();
    rendererMock.setup((x) => x(moq.It.isAny())).callback((_flatNodes: BeInspireTreeNodes<Node>) => {
      if (!tree.visible().some((n) => n.isDirty())) {
        // the Tree component has this check to avoid re-rendering non-dirty
        // trees - have it here as well to catch any places we don't dirty the
        // tree when we should
        return;
      }

      renderedTree = [];
      tree.visible().forEach((n) => {
        handleNodeRender(renderedTree, n);
      });
    });
  });

  // run tests for every type of supported provider
  const providers = [
    { name: "with raw data provider", createProvider: (h: Node[]) => h, isDelayLoaded: false, supportsPagination: false },
    { name: "with promise data provider", createProvider: async (h: Node[]) => Promise.resolve(h), isDelayLoaded: false, supportsPagination: false },
    { name: "with method data provider", createProvider: (h: Node[]) => createDataProviderMethod(h), isDelayLoaded: true, supportsPagination: false },
    { name: "with interface data provider", createProvider: (h: Node[]) => createDataProviderInterface(h), isDelayLoaded: true, supportsPagination: true },
  ];
  providers.forEach((entry) => {

    const mapPayloadToInspireNodeConfig = entry.isDelayLoaded ? mapDelayLoadedNodeToInspireNodeConfig : mapImmediateNodeToInspireNodeConfig;

    describe(entry.name, () => {

      let dataProvider: BeInspireTreeDataProvider<Node>;

      beforeEach(async () => {
        dataProvider = entry.createProvider(hierarchy);
        tree = new BeInspireTree({
          dataProvider,
          renderer: rendererMock.object,
          mapPayloadToInspireNodeConfig,
        });

        await tree.ready;
        if (entry.isDelayLoaded)
          await loadHierarchy(tree.nodes());
      });

      // node access functions can be used directly on the tree or
      // `BeInspireTreeNodes` object - run tests for both cases
      const sourceDefinitions = [
        { name: "tree", createSource: () => tree },
        { name: "nodes", createSource: () => tree.nodes() },
      ];
      sourceDefinitions.forEach((sourceDefinition) => {

        describe(`node access functions: ${sourceDefinition.name}`, () => {

          let source: BeInspireTree<Node> | BeInspireTreeNodes<Node>;
          beforeEach(() => {
            source = sourceDefinition.createSource();
          });

          describe("node", () => {

            it("returns undefined when node is not found", () => {
              const result = source.node("a");
              expect(result).to.be.undefined;
            });

            it("returns root node", () => {
              const result = source.node("1");
              expect(result).to.not.be.undefined;
            });

            it("returns child node", async () => {
              const result = source.node("1-1");
              expect(result).to.not.be.undefined;
            });

          });

          describe("nodes", () => {

            it("returns root nodes", () => {
              const result = source.nodes();
              expect(result.map(asText)).to.deep.eq(["0", "1"]);
            });

            it("returns nodes from different hierarchy levels", () => {
              const result = source.nodes(["0", "0-1", "1-0-1"]);
              expect(result.map(asText)).to.deep.eq(["0", "0-1", "1-0-1"]);
            });

          });

          describe("deepest", () => {

            it("returns leaf nodes", () => {
              const result = source.deepest();
              expect(result.map(asText)).to.deep.eq([
                "0-0-0", "0-0-1", "0-1-0", "0-1-1",
                "1-0-0", "1-0-1", "1-1-0", "1-1-1",
              ]);
            });

          });

          describe("flatten", () => {

            it("returns flat list of nodes", () => {
              const result = source.flatten();
              expect(result.map(asText)).to.deep.eq([
                "0", "0-0", "0-0-0", "0-0-1", "0-1", "0-1-0", "0-1-1",
                "1", "1-0", "1-0-0", "1-0-1", "1-1", "1-1-0", "1-1-1",
              ]);
            });

          });

          describe("expanded", () => {

            it("returns flat list of expanded nodes", async () => {
              await source.node("0")!.expand();
              await source.node("0-0")!.expand();
              const result = source.expanded();
              expect(result.map(asText)).to.deep.eq(["0", "0-0"]);
            });

          });

          describe("collapsed", () => {

            it("returns flat list of collapsed nodes", async () => {
              await source.node("0")!.expand();
              const result = source.collapsed();
              expect(result.map(asText)).to.deep.eq([
                "0-0", "0-0-0", "0-0-1", "0-1", "0-1-0", "0-1-1",
                "1", "1-0", "1-0-0", "1-0-1", "1-1", "1-1-0", "1-1-1",
              ]);
            });

          });

          describe("selected", () => {

            it("returns flat list of selected nodes", async () => {
              source.node("0")!.select();
              source.node("0-1")!.select();
              const result = source.selected();
              expect(result.map(asText)).to.deep.eq(["0", "0-1"]);
            });

          });

          describe("visible", () => {

            it("returns flat list of visible nodes", async () => {
              await source.node("0")!.expand();
              await source.node("0-0")!.expand();
              await source.node("1-0")!.expand();
              const result = source.visible();
              expect(result.map(asText)).to.deep.eq([
                "0", "0-0", "0-0-0", "0-0-1", "0-1", "1",
              ]);
            });

          });

        });

      });

      describe("reload", () => {

        it("re-renders tree", async () => {
          const initialRendersCount = entry.isDelayLoaded ? 2 : 1;
          rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.exactly(initialRendersCount));
          await tree.reload();
          rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.exactly(initialRendersCount + 1));
        });

      });

      describe("auto-expand", () => {

        it("expands root node", async () => {
          const h = createHierarchy(1, 1);
          h[0].autoExpand = true;
          tree = new BeInspireTree<Node>({
            dataProvider: entry.createProvider(h),
            mapPayloadToInspireNodeConfig,
            renderer: rendererMock.object,
          });
          await tree.ready;

          expect(tree.node(h[0].id)!.expanded()).to.be.true;
          expect(tree.node(h[0].id)!.getChildren().length).to.eq(1);
        });

        it("expands root and child node", async () => {
          const h = createHierarchy(1, 2);
          h[0].autoExpand = true;
          h[0].children[0].autoExpand = true;

          tree = new BeInspireTree<Node>({
            dataProvider: entry.createProvider(h),
            mapPayloadToInspireNodeConfig,
            renderer: rendererMock.object,
          });
          await tree.ready;

          const rootNode = tree.node(h[0].id)!;
          expect(rootNode.expanded()).to.be.true;
          expect(rootNode.getChildren().length).to.eq(1);
          expect(rootNode.getChildren()[0].expanded()).to.be.true;
          expect(rootNode.getChildren()[0].getChildren().length).to.eq(1);
        });

        it("expands child node when parent is expanded manually", async () => {
          const h = createHierarchy(1, 2);
          h[0].children[0].autoExpand = true;

          tree = new BeInspireTree<Node>({
            dataProvider: entry.createProvider(h),
            mapPayloadToInspireNodeConfig,
            renderer: rendererMock.object,
          });
          await tree.ready;

          const rootNode = tree.node(h[0].id)!;
          expect(rootNode.expanded()).to.be.false;

          await rootNode.expand();
          expect(rootNode.expanded()).to.be.true;
          expect(rootNode.getChildren().length).to.eq(1);
          expect(rootNode.getChildren()[0].expanded()).to.be.true;
          expect(rootNode.getChildren()[0].getChildren().length).to.eq(1);
        });

        if (entry.supportsPagination) {

          it("expands paginated root node", async () => {
            const h = createHierarchy(2, 1);
            h[1].autoExpand = true;

            tree = new BeInspireTree<Node>({
              dataProvider: entry.createProvider(h),
              mapPayloadToInspireNodeConfig,
              renderer: rendererMock.object,
              pageSize: 1,
            });
            await tree.ready;
            await tree.requestNodeLoad(undefined, 1);

            const rootNode = tree.node(h[1].id)!;
            expect(rootNode.expanded()).to.be.true;
            expect(rootNode.getChildren().length).to.eq(2);
          });

          it("expands paginated child node", async () => {
            const h = createHierarchy(2, 2);
            h[0].children[1].autoExpand = true;

            tree = new BeInspireTree<Node>({
              dataProvider: entry.createProvider(h),
              mapPayloadToInspireNodeConfig,
              renderer: rendererMock.object,
              pageSize: 1,
            });
            await tree.ready;

            const rootNode = tree.node(h[0].id)!;
            await rootNode.expand();
            await tree.requestNodeLoad(rootNode, 1);

            const childNode = tree.node(h[0].children[1].id)!;
            expect(childNode.expanded()).to.be.true;
            expect(childNode.getChildren().length).to.eq(2);
          });

          it("expands paginated root and child node", async () => {
            const h = createHierarchy(2, 2);
            h[1].autoExpand = true;
            h[1].children[0].autoExpand = true;

            tree = new BeInspireTree<Node>({
              dataProvider: entry.createProvider(h),
              mapPayloadToInspireNodeConfig,
              renderer: rendererMock.object,
              pageSize: 1,
            });
            await tree.ready;
            await tree.requestNodeLoad(undefined, 1);

            const rootNode = tree.node(h[1].id)!;
            expect(rootNode.expanded()).to.be.true;
            expect(rootNode.getChildren().length).to.eq(2);

            const childNode = tree.node(h[1].children[0].id)!;
            expect(childNode.expanded()).to.be.true;
            expect(childNode.getChildren().length).to.eq(2);
          });

        }

      });

      describe("updateTreeSelection", () => {

        describe("with predicate", () => {

          it("selects all nodes", () => {
            const ids = flatten(hierarchy).map((n) => n.id);
            tree.updateTreeSelection(() => true);
            tree.nodes(ids).forEach((n) => expect(n.selected()).to.be.true);
            expect(renderedTree).to.matchSnapshot();
          });

          it("deselects nodes that don't match", () => {
            tree.updateTreeSelection((n: Node) => n.id === "0");
            expect(tree.node("0")!.selected()).to.be.true;
            tree.updateTreeSelection((n: Node) => n.id === "1");
            expect(tree.node("0")!.selected()).to.be.false;
            expect(tree.node("1")!.selected()).to.be.true;
            expect(renderedTree).to.matchSnapshot();
          });

        });

        describe("with ids", () => {

          it("selects all nodes", () => {
            const ids = flatten(hierarchy).map((n) => n.id);
            tree.updateTreeSelection(ids);
            tree.nodes(ids).forEach((n) => expect(n.selected()).to.be.true);
            expect(renderedTree).to.matchSnapshot();
          });

          it("deselects nodes that don't match", () => {
            tree.updateTreeSelection(["0"]);
            expect(tree.node("0")!.selected()).to.be.true;
            tree.updateTreeSelection(["1"]);
            expect(tree.node("0")!.selected()).to.be.false;
            expect(tree.node("1")!.selected()).to.be.true;
            expect(renderedTree).to.matchSnapshot();
          });

        });

        it("does nothing when `nodesToSelect` is undefined", () => {
          const ids = flatten(hierarchy).map((n) => n.id);
          tree.updateTreeSelection(undefined);
          tree.nodes(ids).forEach((n) => expect(n.selected()).to.be.false);
          expect(renderedTree).to.matchSnapshot();
        });

        it("fires NodeDeselected and NodeSelected events when not muted", () => {
          const deselectedListener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeDeselected, deselectedListener.object);
          const selectedListener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeSelected, selectedListener.object);
          tree.updateTreeSelection(["0"], false);
          tree.updateTreeSelection(["1"], false);
          selectedListener.verify((x) => x(moq.It.is((n: BeInspireTreeNode<Node>) => n.id === "0"), false), moq.Times.once());
          deselectedListener.verify((x) => x(moq.It.is((n: BeInspireTreeNode<Node>) => n.id === "0"), false), moq.Times.once());
          selectedListener.verify((x) => x(moq.It.is((n: BeInspireTreeNode<Node>) => n.id === "1"), false), moq.Times.once());
        });

        it("doesn't fire NodeDeselected and NodeSelected events by default", () => {
          const deselectedListener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeDeselected, deselectedListener.object);
          const selectedListener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeSelected, selectedListener.object);
          tree.updateTreeSelection(["0"]);
          tree.updateTreeSelection(["1"]);
          deselectedListener.verify((x) => x(moq.It.isAny(), moq.It.isAny()), moq.Times.never());
          selectedListener.verify((x) => x(moq.It.isAny(), moq.It.isAny()), moq.Times.never());
        });

      });

      describe("updateNodesSelection", () => {

        let selectedBeInspireNodes: BeInspireTreeNodes<Node>;
        let selectedInspireNodes: inspire.TreeNodes;

        beforeEach(async () => {
          await tree.node("0")!.expand();
          selectedBeInspireNodes = tree.nodes(flatten(hierarchy[0].children).map((n) => n.id));
          selectedInspireNodes = tree.node("0")!.getChildren();
        });

        describe("with predicate", () => {

          it("selects all nodes", () => {
            const ids = selectedInspireNodes.map((n: inspire.TreeNode) => toNode(n).id!);
            tree.updateNodesSelection(selectedInspireNodes, () => true);
            tree.nodes(ids).forEach((n) => expect(n.selected()).to.be.true);
            expect(renderedTree).to.matchSnapshot();
          });

          it("doesn't deselect other nodes", () => {
            tree.updateNodesSelection(selectedBeInspireNodes, (n: Node) => n.id === "0-0");
            expect(tree.node("0-0")!.selected()).to.be.true;
            tree.updateNodesSelection(selectedBeInspireNodes, (n: Node) => n.id === "0-1");
            expect(tree.node("0-0")!.selected()).to.be.true;
            expect(tree.node("0-1")!.selected()).to.be.true;
            expect(renderedTree).to.matchSnapshot();
          });

        });

        describe("with ids", () => {

          it("selects all nodes", () => {
            const ids = selectedBeInspireNodes.map((n) => n.id!);
            tree.updateNodesSelection(selectedBeInspireNodes, ids);
            tree.nodes(ids).forEach((n) => expect(n.selected()).to.be.true);
            expect(renderedTree).to.matchSnapshot();
          });

          it("doesn't deselect other nodes", () => {
            tree.updateNodesSelection(selectedInspireNodes, ["0-0"]);
            expect(tree.node("0-0")!.selected()).to.be.true;
            tree.updateNodesSelection(selectedInspireNodes, ["0-1"]);
            expect(tree.node("0-0")!.selected()).to.be.true;
            expect(tree.node("0-1")!.selected()).to.be.true;
            expect(renderedTree).to.matchSnapshot();
          });

        });

        it("does nothing when `nodesToSelect` is undefined", () => {
          const ids = selectedBeInspireNodes.map((n) => n.id!);
          tree.updateNodesSelection(selectedBeInspireNodes, undefined);
          tree.nodes(ids).forEach((n) => expect(n.selected()).to.be.false);
          expect(renderedTree).to.matchSnapshot();
        });

        it("fires NodeSelected event when not muted", () => {
          const selectedListener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeSelected, selectedListener.object);
          tree.updateNodesSelection(selectedBeInspireNodes, ["0-1"], false);
          selectedListener.verify((x) => x(moq.It.is((n: BeInspireTreeNode<Node>) => n.id === "0-1"), false), moq.Times.once());
        });

        it("doesn't fire NodeSelected event by default", () => {
          const selectedListener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeSelected, selectedListener.object);
          tree.updateNodesSelection(selectedBeInspireNodes, ["0-1"]);
          selectedListener.verify((x) => x(moq.It.isAny(), moq.It.isAny()), moq.Times.never());
        });

      });

      describe("selectBetween", () => {

        beforeEach(async () => {
          // expand the whole tree so we can test selection between multiple hierarchy levels
          await Promise.all(tree.flatten().collapsed().map(async (n) => n.expand()));
        });

        it("selects nodes at the same hierarchy level", () => {
          const start = tree.node("0-0-0")!;
          const end = tree.node("0-0-1")!;
          const selection = tree.selectBetween(start, end);
          expect(selection.length).to.eq(2);
          selection.forEach((n) => expect(n.selected()).to.be.true);
          expect(renderedTree).to.matchSnapshot();
        });

        it("selects nodes at different hierarchy levels", () => {
          const start = tree.node("0-0")!;
          const end = tree.node("0-0-1")!;
          const selection = tree.selectBetween(start, end);
          expect(selection.length).to.eq(3);
          selection.forEach((n) => expect(n.selected()).to.be.true);
          expect(renderedTree).to.matchSnapshot();
        });

        it("selects nodes at different hierarchy levels with multiple nodes between", () => {
          const start = tree.node("0")!;
          const end = tree.node("1-1-0")!;
          const selection = tree.selectBetween(start, end);
          expect(selection.length).to.eq(13);
          selection.forEach((n) => expect(n.selected()).to.be.true);
          expect(renderedTree).to.matchSnapshot();
        });

        it("selects nodes in reverse order", () => {
          const start = tree.node("0-0-1")!;
          const end = tree.node("0")!;
          const selection = tree.selectBetween(start, end);
          expect(selection.length).to.eq(4);
          selection.forEach((n) => expect(n.selected()).to.be.true);
          expect(renderedTree).to.matchSnapshot();
        });

        it("fires NodeSelected event when not muted", () => {
          const listener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeSelected, listener.object);
          tree.selectBetween(tree.node("0")!, tree.node("0")!, false);
          listener.verify((x) => x(moq.It.is((n: BeInspireTreeNode<Node>) => n.id === "0"), false), moq.Times.once());
        });

        it("doesn't fire NodeSelected event by default", () => {
          const listener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeSelected, listener.object);
          tree.selectBetween(tree.node("0")!, tree.node("0")!);
          listener.verify((x) => x(moq.It.isAny(), moq.It.isAny()), moq.Times.never());
        });

      });

      describe("deselectAll", () => {

        let allNodeIds: string[];

        beforeEach(async () => {
          // expand the whole tree and select all nodes
          allNodeIds = flatten(hierarchy).map((n) => n.id);
          await Promise.all(tree.collapsed().map(async (n) => n.expand()));
          tree.updateTreeSelection(() => true);
        });

        it("deselect all nodes", () => {
          tree.deselectAll();
          tree.nodes(allNodeIds).forEach((n) => expect(n.selected()).to.be.false);
        });

        it("fires NodeDeselected event when not muted", () => {
          const listener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeDeselected, listener.object);
          tree.deselectAll(false);
          allNodeIds.forEach((id) => {
            listener.verify((x) => x(moq.It.is((n: BeInspireTreeNode<Node>) => n.id === id), false), moq.Times.once());
          });
        });

        it("doesn't fire NodeDeselected event by default", () => {
          const listener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
          tree.on(BeInspireTreeEvent.NodeDeselected, listener.object);
          tree.deselectAll();
          listener.verify((x) => x(moq.It.isAny(), moq.It.isAny()), moq.Times.never());
        });

      });

      describe("disposeChildrenOnCollapse", () => {

        if (entry.isDelayLoaded) {

          beforeEach(async () => {
            tree = new BeInspireTree({
              dataProvider,
              renderer: rendererMock.object,
              mapPayloadToInspireNodeConfig,
              disposeChildrenOnCollapse: true,
            });
            await tree.ready;
          });

          it("resets node children", async () => {
            const node = tree.node("0")!;

            await node.expand();
            expect(node.getChildren().length).to.not.eq(0);

            node.collapse();
            expect(node.getChildren().length).to.eq(0);

            await node.expand();
            expect(node.getChildren().length).to.not.eq(0);
          });

        } else {

          it("throws", async () => {
            const ctor = () => new BeInspireTree({
              dataProvider,
              renderer: rendererMock.object,
              mapPayloadToInspireNodeConfig,
              disposeChildrenOnCollapse: true,
            });
            expect(ctor).to.throw();
          });

        }

      });

    });

  });

  describe("events", () => {

    beforeEach(async () => {
      tree = new BeInspireTree({
        dataProvider: hierarchy,
        renderer: rendererMock.object,
        mapPayloadToInspireNodeConfig: mapImmediateNodeToInspireNodeConfig,
      });
      await tree.ready;
      rendererMock.reset();
    });

    it("fires ChangesApplied event when applyChanges is called", () => {
      const listener = moq.Mock.ofInstance(() => { });
      tree.on(BeInspireTreeEvent.ChangesApplied, listener.object);
      tree.applyChanges();
      listener.verify((x) => x(), moq.Times.once());
    });

    it("fires NodeSelected event when node is selected", () => {
      const listener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
      tree.on(BeInspireTreeEvent.NodeSelected, listener.object);
      const node = tree.node("0")!;
      node.select();
      listener.verify((x) => x(moq.It.is((n) => n.id === node.id), false), moq.Times.once());
    });

    it("doesn't fire NodeSelected event when node is selected but the event is muted", () => {
      const listener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
      tree.on(BeInspireTreeEvent.NodeSelected, listener.object);
      const node = tree.node("0")!;
      using(tree.mute([BeInspireTreeEvent.NodeSelected]), () => {
        node.select();
      });
      listener.verify((x) => x(moq.It.isAny(), false), moq.Times.never());
    });

    it("doesn't fire NodeSelected event when node is selected but the listener is removed", () => {
      const listener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
      tree.on(BeInspireTreeEvent.NodeSelected, listener.object);
      tree.removeListener(BeInspireTreeEvent.NodeSelected, listener.object);
      const node = tree.node("0")!;
      node.select();
      listener.verify((x) => x(moq.It.isAny(), false), moq.Times.never());
    });

    it("doesn't fire NodeSelected event when node is selected but all listeners are removed", () => {
      const listener = moq.Mock.ofInstance((_node: BeInspireTreeNode<Node>, _noIdeaWhatThisMeans: boolean) => { });
      tree.on(BeInspireTreeEvent.NodeSelected, listener.object);
      tree.removeAllListeners();
      const node = tree.node("0")!;
      node.select();
      listener.verify((x) => x(moq.It.isAny(), false), moq.Times.never());
    });

    it("calls renderer method when node is selected", () => {
      const node = tree.node("0")!;
      node.select();
      rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.once());
    });

    it("calls renderer method only after rendering is resumed when node is selected and rendering is paused", () => {
      const node = tree.node("0")!;
      using(tree.pauseRendering(2), () => {
        node.select();
        rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.exactly(1));
        node.deselect();
        rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.exactly(2));
        node.select();
        rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.exactly(2));
      });
      rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.exactly(3));
    });

    it("allows `allowedRendersBeforePause` renders before pausing", () => {
      const node = tree.node("0")!;
      const pausedRendering = tree.pauseRendering();
      node.select();
      rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.never());
      pausedRendering.dispose();
      rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.once());
    });

    it("calls renderer method only after outer context is disposed", () => {
      const node = tree.node("0")!;
      using(tree.pauseRendering(), () => {
        using(tree.pauseRendering(), () => {
          node.select();
          rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.never());
        });
        rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.never());
      });
      rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.once());
    });

    it("doesn't call renderer method if no changes done in the hierarchy", () => {
      using(tree.pauseRendering(), () => {
      });
      rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.never());
    });

    it("doesn't call renderer method on excessive pause context disposals", () => {
      const node = tree.node("0")!;
      const pausedRendering = tree.pauseRendering();
      node.select();
      rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.never());
      pausedRendering.dispose();
      rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.once());
      pausedRendering.dispose();
      rendererMock.verify((x) => x(moq.It.isAny()), moq.Times.once());
    });

  });

  describe("pagination", () => {

    let dataProvider: BeInspireTreeDataProviderInterface<Node>;
    let getNodesSpy: sinon.SinonSpy;

    beforeEach(async () => {
      hierarchy = createHierarchy(5, 2);
      dataProvider = createDataProviderInterface(hierarchy);
      getNodesSpy = sinon.spy(dataProvider, "getNodes");
      tree = new BeInspireTree({
        dataProvider,
        renderer: rendererMock.object,
        mapPayloadToInspireNodeConfig: mapDelayLoadedNodeToInspireNodeConfig,
        disposeChildrenOnCollapse: true,
        pageSize: 2,
      });
      await tree.ready;
    });

    it("immediately loads first page for root nodes", async () => {
      expect(getNodesSpy).to.be.calledOnceWith(undefined, { start: 0, size: 2 });
      expect(renderedTree).to.matchSnapshot();
    });

    it("loads additional pages when root nodes are loaded sequentially", async () => {
      await Promise.all(hierarchy.map(async (_n, i) => tree.requestNodeLoad(undefined, i)));
      expect(getNodesSpy).to.be.calledThrice;
      expect(getNodesSpy.firstCall).to.be.calledWith(undefined, { start: 0, size: 2 });
      expect(getNodesSpy.secondCall).to.be.calledWith(undefined, { start: 2, size: 2 });
      expect(getNodesSpy.thirdCall).to.be.calledWith(undefined, { start: 4, size: 2 });
      expect(renderedTree).to.matchSnapshot();
    });

    it("loads necessary pages when root nodes are loaded arbitrarily", async () => {
      await tree.requestNodeLoad(undefined, 4);
      await tree.requestNodeLoad(undefined, 3);
      expect(getNodesSpy).to.be.calledThrice;
      expect(getNodesSpy.firstCall).to.be.calledWith(undefined, { start: 0, size: 2 });
      expect(getNodesSpy.secondCall).to.be.calledWith(undefined, { start: 4, size: 2 });
      expect(getNodesSpy.thirdCall).to.be.calledWith(undefined, { start: 2, size: 2 });
      expect(renderedTree).to.matchSnapshot();
    });

    it("immediately loads first page for child nodes", async () => {
      getNodesSpy.resetHistory();
      const node = tree.node("0")!;
      await node.expand();
      expect(getNodesSpy).to.be.calledOnceWith(node.payload, { start: 0, size: 2 });
      expect(renderedTree).to.matchSnapshot();
    });

    it("loads additional pages when child nodes are loaded sequentially", async () => {
      getNodesSpy.resetHistory();
      const node = tree.node("0")!;
      await node.expand();
      await Promise.all(hierarchy.map(async (_n, i) => tree.requestNodeLoad(node, i)));
      expect(getNodesSpy).to.be.calledThrice;
      expect(getNodesSpy.firstCall).to.be.calledWith(node.payload, { start: 0, size: 2 });
      expect(getNodesSpy.secondCall).to.be.calledWith(node.payload, { start: 2, size: 2 });
      expect(getNodesSpy.thirdCall).to.be.calledWith(node.payload, { start: 4, size: 2 });
      expect(renderedTree).to.matchSnapshot();
    });

    it("loads additional pages when child nodes are loaded arbitrarily", async () => {
      getNodesSpy.resetHistory();
      const node = tree.node("0")!;
      await node.expand();
      await tree.requestNodeLoad(node, 4);
      await tree.requestNodeLoad(node, 3);
      expect(getNodesSpy).to.be.calledThrice;
      expect(getNodesSpy.firstCall).to.be.calledWith(node.payload, { start: 0, size: 2 });
      expect(getNodesSpy.secondCall).to.be.calledWith(node.payload, { start: 4, size: 2 });
      expect(getNodesSpy.thirdCall).to.be.calledWith(node.payload, { start: 2, size: 2 });
      expect(renderedTree).to.matchSnapshot();
    });

    it("calls render callback when child node is loaded for not rendered parent", async () => {
      tree = new BeInspireTree({
        dataProvider: createDataProviderInterface(createHierarchy(2, 3)),
        renderer: rendererMock.object,
        mapPayloadToInspireNodeConfig: mapDelayLoadedNodeToInspireNodeConfig,
        pageSize: 1,
      });
      await tree.ready;

      const node0 = tree.node("0")!;
      await node0.expand();

      const node00 = tree.node("0-0")!;
      await node00.expand();

      // create a situation where node0 is rendered but node00 is not
      node00.setDirty(true);
      node0.setDirty(false);

      await tree.requestNodeLoad(node00, 1);
      expect(renderedTree).to.matchSnapshot();
    });

    it("throws when `requestNodeLoad` is called on tree with non-paginating data provider", async () => {
      tree = new BeInspireTree({
        dataProvider: hierarchy,
        renderer: rendererMock.object,
        mapPayloadToInspireNodeConfig: mapDelayLoadedNodeToInspireNodeConfig,
      });
      await tree.ready;
      await expect(tree.requestNodeLoad(undefined, 0)).to.eventually.be.rejected;
    });

    it("throws when `requestNodeLoad` is called on non-paginated tree", async () => {
      dataProvider = createDataProviderInterface(hierarchy);
      tree = new BeInspireTree({
        dataProvider,
        renderer: rendererMock.object,
        mapPayloadToInspireNodeConfig: mapDelayLoadedNodeToInspireNodeConfig,
      });
      await tree.ready;
      await expect(tree.requestNodeLoad(undefined, 0)).to.eventually.be.rejected;
    });

    it("handles children disposal during page load", async () => {
      const node = tree.node("0")!;
      await node.expand();
      getNodesSpy.resetHistory();

      const p = tree.requestNodeLoad(node, 2);
      node.collapse();
      await p;

      // expect `getNodes` to be called
      expect(getNodesSpy).to.be.calledOnce;
      // but expect children to be `true` because it was reset on collapse
      expect(node.children).to.be.true;
    });

    it("doesn't request nodes when loadChildren is called", async () => {
      const node = tree.node("0")!;
      await node.expand();
      const renderedTreeBefore = renderedTree;
      getNodesSpy.resetHistory();

      await node.loadChildren();

      expect(getNodesSpy).to.not.be.called;
      expect(renderedTree).to.deep.eq(renderedTreeBefore); // expect children to not change
    });

  });

});
