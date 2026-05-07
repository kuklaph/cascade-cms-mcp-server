type Nodelet = {
  identifier: string;
  type: "group" | "text" | "asset";
  text?: string;
  pagePath?: string;
  filePath?: string;
  symlinkPath?: string;
  structuredDataNodes?: Nodelet[];
};

function node(
  identifier: string,
  type: Nodelet["type"] = "group",
  children: Nodelet[] = [],
  extra: Omit<Nodelet, "identifier" | "type" | "structuredDataNodes"> = {},
): Nodelet {
  return {
    identifier,
    type,
    ...extra,
    ...(children.length > 0 ? { structuredDataNodes: children } : {}),
  };
}

function textNode(identifier: string, text: string): Nodelet {
  return node(identifier, "text", [], { text });
}

function assetNode(identifier: string, extra: Pick<Nodelet, "pagePath" | "filePath" | "symlinkPath">): Nodelet {
  return node(identifier, "asset", [], extra);
}

function makeBlock(name: string, roots: Nodelet[]) {
  return {
    xhtmlDataDefinitionBlock: {
      id: `block-${name}`,
      name,
      path: `_cms/base-assets/${name}`,
      type: "xhtmlDataDefinitionBlock",
      structuredData: {
        structuredDataNodes: roots,
      },
    },
  };
}

function numberedTextNodes(prefix: string, count: number): Nodelet[] {
  return Array.from({ length: count }, (_, index) =>
    textNode(`${prefix}-${index + 1}`, `${prefix} text ${index + 1}`),
  );
}

function groupedTextNodes(prefix: string, groups: number, perGroup: number): Nodelet[] {
  return Array.from({ length: groups }, (_, groupIndex) =>
    node(
      `${prefix}-group-${groupIndex + 1}`,
      "group",
      numberedTextNodes(`${prefix}-${groupIndex + 1}`, perGroup),
    ),
  );
}

export const tabsFixture = makeBlock("tabs", [
  node("tabs", "group", [
    textNode("caption", "<p>Caption content with HTML markup.</p>"),
    ...groupedTextNodes("tab", 3, 2),
  ]),
]);

export const storySliderFixture = makeBlock("story-slider", [
  node("story-slider", "group", [
    assetNode("hero-page", { pagePath: "page,file,symlink" }),
    assetNode("hero-file", { filePath: "_files/hero.jpg" }),
    assetNode("hero-symlink", { symlinkPath: "site/redirect" }),
    ...Array.from({ length: 9 }, (_, slideIndex) =>
      node(`slide-${slideIndex + 1}`, "group", [
        textNode(`slide-${slideIndex + 1}-heading`, `Slide ${slideIndex + 1} heading`),
        textNode(`slide-${slideIndex + 1}-summary`, `Slide ${slideIndex + 1} summary`),
        assetNode(`slide-${slideIndex + 1}-page`, {
          pagePath: `stories/slide-${slideIndex + 1}`,
        }),
        textNode(`slide-${slideIndex + 1}-cta`, `Slide ${slideIndex + 1} call to action`),
        textNode(`slide-${slideIndex + 1}-caption`, `Slide ${slideIndex + 1} caption`),
      ]),
    ),
    ...numberedTextNodes("story-extra", 4),
  ]),
]);

export const wysiwygFixture = makeBlock("wysiwyg", [
  node("wysiwyg", "group", numberedTextNodes("wysiwyg", 5)),
]);

export const buttonBlockFixture = makeBlock("button-block", [
  node("button-block", "group", [
    textNode("label", "Learn more"),
    textNode("url", "/academics"),
    textNode("style", "primary"),
    ...groupedTextNodes("button", 3, 1),
  ]),
]);

export const accrdnFixture = makeBlock("accrdn", [
  node("accrdn", "group", [
    ...Array.from({ length: 7 }, (_, itemIndex) =>
      node(`item-${itemIndex + 1}`, "group", [
        textNode(`item-${itemIndex + 1}-heading`, `Accordion ${itemIndex + 1}`),
        textNode(`item-${itemIndex + 1}-body`, `Accordion body ${itemIndex + 1}`),
        textNode(`item-${itemIndex + 1}-link`, `/accordion/${itemIndex + 1}`),
      ]),
    ),
    textNode("footer-note", "Accordion footer"),
  ]),
]);

export const pageFixture = {
  page: {
    id: "page-fixture",
    name: "index",
    path: "/fixture/index",
    siteId: "site-fixture",
    siteName: "Fixture Site",
    type: "page",
    contentTypeId: "content-type-fixture",
    contentTypePath: "/content-types/default",
    pageConfigurations: [
      {
        name: "default",
        templateId: "template-fixture",
        templatePath: "/templates/main",
        pageRegions: [
          {
            name: "DEFAULT",
            blockId: "block-fixture",
            blockPath: "/blocks/main",
            formatPath: "/formats/main",
            noBlock: false,
            noFormat: true,
          },
        ],
      },
    ],
    structuredData: {
      structuredDataNodes: [
        node("page-root", "group", [
          ...Array.from({ length: 25 }, (_, sectionIndex) =>
            node(`section-${sectionIndex + 1}`, "group", [
              textNode(`section-${sectionIndex + 1}-heading`, `Section ${sectionIndex + 1}`),
              textNode(`section-${sectionIndex + 1}-body`, `Body ${sectionIndex + 1}`),
              assetNode(`section-${sectionIndex + 1}-page-link`, {
                pagePath: `fixture/section-${sectionIndex + 1}`,
              }),
              textNode(`section-${sectionIndex + 1}-summary`, `Summary ${sectionIndex + 1}`),
            ]),
          ),
          ...numberedTextNodes("page-extra", 26),
        ]),
      ],
    },
  },
};

export const nonPageAssets = {
  scriptFormat: {
    scriptFormat: {
      id: "format-fixture",
      name: "main-format",
      path: "/formats/main",
      type: "scriptFormat",
      script: "return 'fixture';",
    },
  },
  dataDefinition: {
    dataDefinition: {
      id: "data-definition-fixture",
      name: "article",
      path: "/data-definitions/article",
      type: "dataDefinition",
      xml: "<system-data-structure/>",
    },
  },
  template: {
    template: {
      id: "template-fixture",
      name: "main",
      path: "/templates/main",
      type: "template",
      xml: "<template/>",
    },
  },
  indexBlock: {
    indexBlock: {
      id: "index-block-fixture",
      name: "news-index",
      path: "/blocks/news-index",
      type: "indexBlock",
    },
  },
  metadataSet: {
    metadataSet: {
      id: "metadata-set-fixture",
      name: "default",
      path: "/metadata/default",
      type: "metadataSet",
    },
  },
  site: {
    site: {
      id: "site-fixture",
      name: "Fixture Site",
      path: "/",
      type: "site",
    },
  },
  file: {
    file: {
      id: "file-fixture",
      name: "example.txt",
      path: "/_files/example.txt",
      type: "file",
      text: "fixture file",
    },
  },
};
