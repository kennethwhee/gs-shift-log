"use strict";

// Loaded before the desktop runtime. Installation stays at its original call site.
window.GSShiftLogSearchMatchedItems = Object.freeze({
  install: function installShiftLogSearchMatchedItemsV1() {
  if (
    typeof window !== "undefined" &&
    window.__shiftLogSearchMatchedItemsV1Installed === true
  ) {
    return;
  }

  if (typeof window !== "undefined") {
    window.__shiftLogSearchMatchedItemsV1Installed = true;
  }

  const originalCreateSearchLogText =
    typeof createSearchLogText === "function"
      ? createSearchLogText
      : null;

  const originalCreateSearchLogPreviewHtml =
    typeof createSearchLogPreviewHtml === "function"
      ? createSearchLogPreviewHtml
      : null;

  const originalCreateSearchLogPreviewText =
    typeof createSearchLogPreviewText === "function"
      ? createSearchLogPreviewText
      : null;

  function getSearchFormControlValue(
    controlName
  ) {
    const searchForm =
      typeof elements !== "undefined"
        ? elements?.searchForm
        : null;

    if (searchForm) {
      try {
        if (
          typeof FormData ===
          "function"
        ) {
          const formData =
            new FormData(
              searchForm
            );

          const formValue =
            formData.get(
              controlName
            );

          if (
            formValue !==
              null &&
            formValue !==
              undefined
          ) {
            return String(
              formValue
            ).trim();
          }
        }
      } catch (
        error
      ) {
        /*
          Node test / legacy browser fallback:
          querySelector path below handles it.
        */
      }

      const directControl =
        typeof searchForm.querySelector ===
          "function"
          ? searchForm.querySelector(
              `[name="${controlName}"]`
            )
          : null;

      if (
        directControl
      ) {
        return String(
          directControl.value ||
          ""
        ).trim();
      }
    }

    if (
      typeof document !==
        "undefined" &&
      typeof document.querySelector ===
        "function"
    ) {
      const fallbackControl =
        document.querySelector(
          `[name="${controlName}"]`
        );

      if (
        fallbackControl
      ) {
        return String(
          fallbackControl.value ||
          ""
        ).trim();
      }
    }

    return "";
  }

  function getActiveSearchKeyword() {
    return getSearchFormControlValue(
      "keyword"
    );
  }

  function getActiveSearchCategory() {
    const category =
      String(
        getSearchFormControlValue(
          "category"
        ) ||
        ""
      )
        .trim()
        .toLocaleLowerCase();

    if (
      !category ||
      category ===
        "all" ||
      category ===
        "전체"
    ) {
      return "";
    }

    return category;
  }

  function normalizeSearchText(
    value
  ) {
    return String(
      value ??
      ""
    )
      .trim()
      .toLocaleLowerCase();
  }

  function normalizeSearchEntry(
    rawEntry,
    fallbackCategory = ""
  ) {
    if (
      rawEntry ===
        null ||
      rawEntry ===
        undefined
    ) {
      return null;
    }

    const sourceEntry =
      typeof rawEntry ===
        "object"
        ? {
            ...rawEntry
          }
        : {
            content:
              String(
                rawEntry
              )
          };

    const content =
      String(
        sourceEntry.content ??
        sourceEntry.description ??
        sourceEntry.text ??
        ""
      ).trim();

    const tag =
      String(
        sourceEntry.tag ??
        sourceEntry.tagId ??
        sourceEntry.tag_id ??
        ""
      )
        .trim()
        .toUpperCase();

    if (
      !content &&
      !tag
    ) {
      return null;
    }

    return {
      ...sourceEntry,

      category:
        String(
          sourceEntry.category ||
          fallbackCategory ||
          ""
        ).trim(),

      time:
        String(
          sourceEntry.time ||
          ""
        ).trim(),

      tag,

      content
    };
  }

  function getSearchEntryCategoryValueSafe(
    entry
  ) {
    if (
      typeof getSearchEntryCategoryValue ===
        "function"
    ) {
      try {
        return String(
          getSearchEntryCategoryValue(
            entry
          ) ||
          ""
        ).trim();
      } catch (
        error
      ) {
        /*
          fallback below
        */
      }
    }

    const category =
      String(
        entry?.category ||
        ""
      )
        .trim()
        .toUpperCase();

    if (
      category.startsWith(
        "TM"
      )
    ) {
      return "tm";
    }

    if (
      category.startsWith(
        "BM"
      )
    ) {
      return "bm";
    }

    if (
      category.startsWith(
        "CM"
      )
    ) {
      return "cm";
    }

    if (
      category ===
        "인계사항" ||
      category ===
        "인계 사항"
    ) {
      return "handover";
    }

    if (
      category ===
      "비고"
    ) {
      return "note";
    }

    return "";
  }

  function doesSearchEntryMatchCategory(
    entry,
    selectedCategory
  ) {
    const normalizedCategory =
      String(
        selectedCategory ||
        ""
      ).trim();

    if (
      !normalizedCategory
    ) {
      return true;
    }

    /*
      keyword 검색에서는 운전현황을
      검색 대상에서 완전히 제외한다.

      단, keyword가 비어 있는 일반 "구분=운전현황"
      필터 조회는 기존 runSearch()가 그대로 처리한다.
    */
    if (
      normalizedCategory ===
      "operation"
    ) {
      return false;
    }

    return (
      getSearchEntryCategoryValueSafe(
        entry
      ) ===
      normalizedCategory
    );
  }

  function createSearchEntryUniqueKey(
    entry,
    entryIndex
  ) {
    const entryId =
      String(
        entry?.id ||
        ""
      ).trim();

    if (
      entryId
    ) {
      return `ID||${entryId}`;
    }

    return [
      String(
        entry?.importedFromRole ||
        entry?.leaderTargetRole ||
        entry?.role ||
        ""
      ).trim(),

      String(
        entry?.category ||
        ""
      ).trim(),

      String(
        entry?.time ||
        ""
      ).trim(),

      String(
        entry?.tag ||
        ""
      ).trim(),

      String(
        entry?.content ||
        ""
      )
        .trim()
        .replace(
          /\s+/g,
          " "
        ),

      String(
        entryIndex
      )
    ].join(
      "||"
    );
  }

  function collectSearchBusinessEntries(
    log
  ) {
    let collectedEntries = [];

    /*
      최신 화면 표시와 동일한 정규화 함수를
      가장 먼저 사용한다.
      이 함수에는 운전현황이 포함되지 않는다.
    */
    if (
      typeof collectLogEntriesForDisplay ===
        "function"
    ) {
      try {
        const displayEntries =
          collectLogEntriesForDisplay(
            log
          );

        if (
          Array.isArray(
            displayEntries
          )
        ) {
          collectedEntries =
            displayEntries;
        }
      } catch (
        error
      ) {
        console.warn?.(
          "조회용 업무 항목 정규화 fallback:",
          error
        );
      }
    }

    /*
      legacy / 과거 자료 fallback.
    */
    if (
      !collectedEntries.length
    ) {
      const entrySources = [
        [
          log?.entries,
          ""
        ],

        [
          log?.tmEntries,
          "TM 발행"
        ],

        [
          log?.handoverEntries,
          "인계사항"
        ],

        [
          log?.remarkEntries,
          "비고"
        ]
      ];

      entrySources.forEach(
        (
          [
            sourceEntries,
            fallbackCategory
          ]
        ) => {
          if (
            !Array.isArray(
              sourceEntries
            )
          ) {
            return;
          }

          sourceEntries.forEach(
            rawEntry => {
              const normalizedEntry =
                normalizeSearchEntry(
                  rawEntry,
                  fallbackCategory
                );

              if (
                normalizedEntry
              ) {
                collectedEntries.push(
                  normalizedEntry
                );
              }
            }
          );
        }
      );
    }

    const normalizedEntries =
      collectedEntries
        .map(
          rawEntry => {
            return normalizeSearchEntry(
              rawEntry
            );
          }
        )
        .filter(
          Boolean
        );

    /*
      log.note가 별도 필드로 남아 있는
      과거 자료도 검색할 수 있게 합친다.
    */
    const logNote =
      String(
        log?.note ||
        ""
      ).trim();

    if (
      logNote
    ) {
      const alreadyHasSameNote =
        normalizedEntries.some(
          entry => {
            return (
              getSearchEntryCategoryValueSafe(
                entry
              ) ===
                "note" &&
              String(
                entry?.content ||
                ""
              ).trim() ===
                logNote
            );
          }
        );

      if (
        !alreadyHasSameNote
      ) {
        normalizedEntries.push({
          category:
            "비고",

          time:
            "",

          tag:
            "",

          content:
            logNote,

          __searchSyntheticNote:
            true
        });
      }
    }

    const usedKeys =
      new Set();

    return normalizedEntries.filter(
      (
        entry,
        entryIndex
      ) => {
        const uniqueKey =
          createSearchEntryUniqueKey(
            entry,
            entryIndex
          );

        if (
          usedKeys.has(
            uniqueKey
          )
        ) {
          return false;
        }

        usedKeys.add(
          uniqueKey
        );

        return true;
      }
    );
  }

  function createSearchEntryText(
    entry
  ) {
    return [
      entry?.category,
      entry?.time,
      entry?.tag,
      entry?.content
    ]
      .filter(
        Boolean
      )
      .join(
        " "
      )
      .toLocaleLowerCase();
  }

  function getMatchedSearchEntries(
    log
  ) {
    const keyword =
      normalizeSearchText(
        getActiveSearchKeyword()
      );

    if (
      !keyword
    ) {
      return [];
    }

    const selectedCategory =
      getActiveSearchCategory();

    return collectSearchBusinessEntries(
      log
    ).filter(
      entry => {
        return (
          doesSearchEntryMatchCategory(
            entry,
            selectedCategory
          ) &&
          createSearchEntryText(
            entry
          ).includes(
            keyword
          )
        );
      }
    );
  }

  function escapeSearchResultHtml(
    value
  ) {
    return String(
      value ??
      ""
    )
      .replaceAll(
        "&",
        "&amp;"
      )
      .replaceAll(
        "<",
        "&lt;"
      )
      .replaceAll(
        ">",
        "&gt;"
      )
      .replaceAll(
        '"',
        "&quot;"
      )
      .replaceAll(
        "'",
        "&#039;"
      );
  }

  function highlightSearchResultText(
    value,
    keyword
  ) {
    const sourceText =
      String(
        value ??
        ""
      );

    const normalizedKeyword =
      normalizeSearchText(
        keyword
      );

    if (
      !sourceText ||
      !normalizedKeyword
    ) {
      return escapeSearchResultHtml(
        sourceText
      ).replace(
        /\r?\n/g,
        "<br>"
      );
    }

    const lowerSource =
      sourceText.toLocaleLowerCase();

    let searchIndex =
      0;

    let outputHtml =
      "";

    while (
      searchIndex <
      sourceText.length
    ) {
      const matchedIndex =
        lowerSource.indexOf(
          normalizedKeyword,
          searchIndex
        );

      if (
        matchedIndex <
        0
      ) {
        outputHtml +=
          escapeSearchResultHtml(
            sourceText.slice(
              searchIndex
            )
          );

        break;
      }

      outputHtml +=
        escapeSearchResultHtml(
          sourceText.slice(
            searchIndex,
            matchedIndex
          )
        );

      outputHtml +=
        `<mark class="search-match-highlight">${escapeSearchResultHtml(
          sourceText.slice(
            matchedIndex,
            matchedIndex +
            normalizedKeyword.length
          )
        )}</mark>`;

      searchIndex =
        matchedIndex +
        normalizedKeyword.length;
    }

    return outputHtml.replace(
      /\r?\n/g,
      "<br>"
    );
  }

  function getSearchEntryRoleLabel(
    log,
    entry
  ) {
    const entryRole =
      String(
        entry?.importedFromRole ||
        entry?.leaderTargetRole ||
        entry?.role ||
        ""
      ).trim();

    if (
      !entryRole
    ) {
      return "";
    }

    const logRole =
      String(
        log?.role ||
        ""
      ).trim();

    if (
      entryRole ===
      logRole
    ) {
      return "";
    }

    return `${entryRole} 업무일지`;
  }

  function createMatchedSearchPreviewHtml(
    log,
    matchedEntries,
    keyword
  ) {
    if (
      !matchedEntries.length
    ) {
      return `
        <span class="search-result-matches__empty">
          검색어와 일치하는 업무 항목이 없습니다.
        </span>
      `;
    }

    const matchedItemsHtml =
      matchedEntries
        .map(
          (
            entry,
            entryIndex
          ) => {
            const roleLabel =
              getSearchEntryRoleLabel(
                log,
                entry
              );

            const category =
              String(
                entry?.category ||
                ""
              ).trim();

            const time =
              String(
                entry?.time ||
                ""
              ).trim();

            const tag =
              String(
                entry?.tag ||
                ""
              )
                .trim()
                .toUpperCase();

            const content =
              String(
                entry?.content ||
                ""
              ).trim();

            const metaParts = [];

            if (
              roleLabel
            ) {
              metaParts.push(
                `
                  <span class="search-result-match__role">
                    ${escapeSearchResultHtml(
                      roleLabel
                    )}
                  </span>
                `
              );
            }

            if (
              category
            ) {
              metaParts.push(
                `
                  <span class="search-result-match__category">
                    ${highlightSearchResultText(
                      category,
                      keyword
                    )}
                  </span>
                `
              );
            }

            if (
              time
            ) {
              metaParts.push(
                `
                  <span class="search-result-match__time">
                    ${highlightSearchResultText(
                      time,
                      keyword
                    )}
                  </span>
                `
              );
            }

            const tagHtml =
              tag
                ? `
                    <button
                      type="button"
                      class="search-result-match__tag"
                      data-search-tag="${escapeSearchResultHtml(
                        tag
                      )}"
                      title="Facility Navigator에서 설비 보기"
                    >
                      ${highlightSearchResultText(
                        `[${tag}]`,
                        keyword
                      )}
                    </button>
                  `
                : "";

            return `
              <div
                class="search-result-match"
                data-search-match-index="${entryIndex}"
              >
                ${
                  metaParts.length
                    ? `
                        <div class="search-result-match__meta">
                          ${metaParts.join(
                            ""
                          )}
                        </div>
                      `
                    : ""
                }

                <div class="search-result-match__body">
                  ${
                    content
                      ? `
                          <div class="search-result-match__content">
                            ${highlightSearchResultText(
                              content,
                              keyword
                            )}
                          </div>
                        `
                      : ""
                  }

                  ${tagHtml}
                </div>
              </div>
            `;
          }
        )
        .join(
          ""
        );

    return `
      <div class="search-result-matches">
        ${matchedItemsHtml}

        <div class="search-result-matches__hint">
          클릭하면 업무일지 전체 내용을 확인할 수 있습니다.
        </div>
      </div>
    `;
  }

  /*
    1. keyword 검색 문자열 재정의

    - 운전현황 제외
    - 업무 항목(category/time/TAG/content) + 비고만 검색
    - 날짜/근무/보직/작성자는 별도 필터에서 처리
  */
  if (
    originalCreateSearchLogText
  ) {
    createSearchLogText =
      function createSearchLogTextWithoutOperationStatus(
        log
      ) {
        const keyword =
          getActiveSearchKeyword();

        if (
          !keyword
        ) {
          /*
            keyword 없는 일반 조회는
            기존 동작을 건드리지 않는다.
          */
          return originalCreateSearchLogText(
            log
          );
        }

        const selectedCategory =
          getActiveSearchCategory();

        return collectSearchBusinessEntries(
          log
        )
          .filter(
            entry => {
              return doesSearchEntryMatchCategory(
                entry,
                selectedCategory
              );
            }
          )
          .map(
            createSearchEntryText
          )
          .filter(
            Boolean
          )
          .join(
            " "
          );
      };
  }

  /*
    2. PC 검색 결과 미리보기 재정의

    keyword가 있으면:
    - 일치한 업무 항목만 표시
    - 원본 log 객체는 그대로 유지
      → 기존 행 클릭 상세보기는 전체 업무일지 표시
  */
  if (
    originalCreateSearchLogPreviewHtml
  ) {
    createSearchLogPreviewHtml =
      function createSearchLogMatchedPreviewHtml(
        log
      ) {
        const keyword =
          getActiveSearchKeyword();

        if (
          !keyword
        ) {
          return originalCreateSearchLogPreviewHtml(
            log
          );
        }

        return createMatchedSearchPreviewHtml(
          log,
          getMatchedSearchEntries(
            log
          ),
          keyword
        );
      };
  }

  /*
    3. 모바일 검색 카드 요약 재정의

    모바일도 keyword가 있으면
    일치 항목만 텍스트 요약으로 표시한다.
  */
  if (
    originalCreateSearchLogPreviewText
  ) {
    createSearchLogPreviewText =
      function createSearchLogMatchedPreviewText(
        log
      ) {
        const keyword =
          getActiveSearchKeyword();

        if (
          !keyword
        ) {
          return originalCreateSearchLogPreviewText(
            log
          );
        }

        const matchedEntries =
          getMatchedSearchEntries(
            log
          );

        if (
          !matchedEntries.length
        ) {
          return "검색어와 일치하는 업무 항목이 없습니다.";
        }

        return matchedEntries
          .map(
            entry => {
              const parts = [
                entry?.time,
                entry?.tag
                  ? `[${String(
                      entry.tag
                    )
                      .trim()
                      .toUpperCase()}]`
                  : "",
                entry?.content
              ]
                .filter(
                  Boolean
                );

              return parts.join(
                " "
              );
            }
          )
          .join(
            " · "
          );
      };
  }

  /*
    테스트/진단용 공개 함수.
    일반 화면 동작에는 사용하지 않는다.
  */
  if (
    typeof window !==
    "undefined"
  ) {
    window.__shiftLogSearchMatchedItemsV1 = {
      collectSearchBusinessEntries,
      getMatchedSearchEntries,
      createSearchEntryText
    };
  }
}
});
