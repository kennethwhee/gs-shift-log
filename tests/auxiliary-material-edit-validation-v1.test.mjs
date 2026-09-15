import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

import {
  onRequestPost,
  __oisDataRequestsTest
} from "../functions/api/ois-data-requests.js";


const scriptSource =
  readFileSync(
    new URL(
      "../script.js",
      import.meta.url
    ),
    "utf8"
  )
    .replace(
      /\r\n?/g,
      "\n"
    );


function createClassList(...initialNames) {
  const names =
    new Set(
      initialNames
    );


  return {
    add(...values) {
      values.forEach(
        value =>
          names.add(
            value
          )
      );
    },

    remove(...values) {
      values.forEach(
        value =>
          names.delete(
            value
          )
      );
    },

    contains(value) {
      return names.has(
        value
      );
    }
  };
}


function createInput({
  recordDate,
  unitNo,
  field,
  value,
  originalValue,
  remarks =
    false,
  unitNos =
    ""
}) {
  const attributes = {};


  return {
    value,

    dataset: remarks
      ? {
          recordDate,
          unitNos,
          originalValue
        }
      : {
          recordDate,
          unitNo:
            String(
              unitNo
            ),
          field,
          originalValue
        },

    classList:
      createClassList(
        remarks
          ? "auxiliary-material-remarks-input"
          : "auxiliary-material-value-input"
      ),

    attributes,
    focused:
      false,
    selected:
      false,
    scrolled:
      false,

    setAttribute(name, nextValue) {
      attributes[name] =
        String(
          nextValue
        );
    },

    removeAttribute(name) {
      delete attributes[name];
    },

    focus() {
      this.focused =
        true;
    },

    select() {
      this.selected =
        true;
    },

    scrollIntoView() {
      this.scrolled =
        true;
    }
  };
}


function createUiHarness({
  historyItems,
  valueInputs = [],
  remarksInputs = []
}) {
  const document = {
    querySelectorAll(selector) {
      if (
        selector ===
          "#auxiliaryMaterialTableBody .auxiliary-material-value-input"
      ) {
        return valueInputs;
      }


      if (
        selector ===
          "#auxiliaryMaterialTableBody .auxiliary-material-remarks-input"
      ) {
        return remarksInputs;
      }


      if (
        selector.includes(
          ".is-invalid"
        )
      ) {
        return [
          ...valueInputs,
          ...remarksInputs
        ].filter(
          input =>
            input.classList.contains(
              "is-invalid"
            )
        );
      }


      return [];
    }
  };


  const start =
    scriptSource.indexOf(
      "const auxiliaryMaterialValueEditState ="
    );


  const end =
    scriptSource.indexOf(
      "/* =========================================================\n  부재료 수치 수정 모드",
      start
    );


  assert.ok(
    start >=
      0 &&
    end >
      start,
    "auxiliary material edit source slice must exist"
  );


  const exposedSource =
    scriptSource.slice(
      start,
      end
    ) +
    `
      globalThis.__auxiliaryMaterialEditTest = {
        collectAuxiliaryMaterialChangedRecords,
        focusAuxiliaryMaterialInvalidInput,
        clearAuxiliaryMaterialInputValidation
      };
    `;


  const context =
    vm.createContext({
      console,
      document,
      auxiliaryMaterialHistoryState: {
        items:
          historyItems,
        fixedDensitySettings: []
      }
    });


  vm.runInContext(
    exposedSource,
    context
  );


  return context
    .__auxiliaryMaterialEditTest;
}


function plain(value) {
  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}


test(
  "untouched negative OIS NOx in another row does not block a sparse edit",
  () => {
    const negativeNox =
      createInput({
        recordDate:
          "2026-09-01",
        unitNo:
          2,
        field:
          "noxPpm",
        value:
          "-0.04",
        originalValue:
          "-0.04"
      });


    const changedSox =
      createInput({
        recordDate:
          "2026-09-15",
        unitNo:
          1,
        field:
          "soxPpm",
        value:
          "14.00",
        originalValue:
          "13.03"
      });


    const ui =
      createUiHarness({
        historyItems: [
          {
            recordDate:
              "2026-09-01",
            unitNo:
              2,
            noxPpm:
              -0.04,
            revision:
              1
          },
          {
            recordDate:
              "2026-09-15",
            unitNo:
              1,
            soxPpm:
              13.03,
            revision:
              4
          }
        ],
        valueInputs: [
          negativeNox,
          changedSox
        ]
      });


    assert.deepEqual(
      plain(
        ui.collectAuxiliaryMaterialChangedRecords()
      ),
      [
        {
          recordDate:
            "2026-09-15",
          unitNo:
            1,
          revision:
            4,
          values: {
            soxPpm:
              14
          },
          remarksChanged:
            false,
          changedFields: [
            "soxPpm"
          ]
        }
      ]
    );
  }
);


test(
  "same-row numeric and remarks edits preserve untouched negative NOx",
  () => {
    const negativeNox =
      createInput({
        recordDate:
          "2026-09-01",
        unitNo:
          2,
        field:
          "noxPpm",
        value:
          "-0.04",
        originalValue:
          "-0.04"
      });


    const changedUsage =
      createInput({
        recordDate:
          "2026-09-01",
        unitNo:
          2,
        field:
          "limestoneUsageTpd",
        value:
          "35.00",
        originalValue:
          "34.76"
      });


    const changedRemarks =
      createInput({
        recordDate:
          "2026-09-01",
        remarks:
          true,
        unitNos:
          "2",
        value:
          "확인 완료",
        originalValue:
          "기존 비고"
      });


    const historyItems = [
      {
        recordDate:
          "2026-09-01",
        unitNo:
          2,
        noxPpm:
          -0.04,
        limestoneUsageTpd:
          34.76,
        remarks:
          "기존 비고",
        revision:
          7
      }
    ];


    const numericUi =
      createUiHarness({
        historyItems,
        valueInputs: [
          negativeNox,
          changedUsage
        ]
      });


    assert.deepEqual(
      plain(
        numericUi.collectAuxiliaryMaterialChangedRecords()
      )[0],
      {
        recordDate:
          "2026-09-01",
        unitNo:
          2,
        revision:
          7,
        values: {
          limestoneUsageTpd:
            35
        },
        remarksChanged:
          false,
        changedFields: [
          "limestoneUsageTpd"
        ]
      }
    );


    const remarksUi =
      createUiHarness({
        historyItems,
        valueInputs: [
          negativeNox
        ],
        remarksInputs: [
          changedRemarks
        ]
      });


    assert.deepEqual(
      plain(
        remarksUi.collectAuxiliaryMaterialChangedRecords()
      )[0],
      {
        recordDate:
          "2026-09-01",
        unitNo:
          2,
        revision:
          7,
        values: {},
        remarks:
          "확인 완료",
        remarksChanged:
          true,
        changedFields: []
      }
    );
  }
);


test(
  "new invalid manual value identifies, focuses and clears the exact input",
  () => {
    const changedNox =
      createInput({
        recordDate:
          "2026-09-01",
        unitNo:
          2,
        field:
          "noxPpm",
        value:
          "-0.05",
        originalValue:
          "-0.04"
      });


    const ui =
      createUiHarness({
        historyItems: [
          {
            recordDate:
              "2026-09-01",
            unitNo:
              2,
            noxPpm:
              -0.04,
            revision:
              1
          }
        ],
        valueInputs: [
          changedNox
        ]
      });


    let validationError;


    try {
      ui.collectAuxiliaryMaterialChangedRecords();

    } catch (error) {
      validationError =
        error;
    }


    assert.ok(
      validationError &&
      typeof validationError.message ===
        "string"
    );
    assert.match(
      validationError.message,
      /2026-09-01 2호기 NOx/
    );
    assert.equal(
      validationError.auxiliaryMaterialInvalidInput,
      changedNox
    );


    ui.focusAuxiliaryMaterialInvalidInput(
      validationError
    );


    assert.equal(
      changedNox.classList.contains(
        "is-invalid"
      ),
      true
    );
    assert.equal(
      changedNox.attributes[
        "aria-invalid"
      ],
      "true"
    );
    assert.equal(
      changedNox.focused,
      true
    );
    assert.equal(
      changedNox.selected,
      true
    );
    assert.equal(
      changedNox.scrolled,
      true
    );


    ui.clearAuxiliaryMaterialInputValidation(
      changedNox
    );


    assert.equal(
      changedNox.classList.contains(
        "is-invalid"
      ),
      false
    );
    assert.equal(
      "aria-invalid" in
        changedNox.attributes,
      false
    );
  }
);


test(
  "save validation catch passes the rejected input to the focus helper",
  async () => {
    const validationError =
      new Error(
        "범위 오류"
      );


    const focusedErrors = [];


    const start =
      scriptSource.indexOf(
        "async function saveAuxiliaryMaterialEditedValues()"
      );


    const end =
      scriptSource.indexOf(
        "/* =========================================================\n  유량·밀도 수정 시",
        start
      );


    assert.ok(
      start >=
        0 &&
      end >
        start
    );


    const context =
      vm.createContext({
        Error,

        collectAuxiliaryMaterialChangedRecords() {
          throw validationError;
        },

        setAuxiliaryMaterialStatus() {},

        showToast() {},

        focusAuxiliaryMaterialInvalidInput(error) {
          focusedErrors.push(
            error
          );
        }
      });


    vm.runInContext(
      scriptSource.slice(
        start,
        end
      ) +
      "\nglobalThis.__saveEditedValues = saveAuxiliaryMaterialEditedValues;",
      context
    );


    await context
      .__saveEditedValues();


    assert.deepEqual(
      focusedErrors,
      [
        validationError
      ]
    );
  }
);


test(
  "unchanged legacy long remarks do not block a numeric edit",
  () => {
    const legacyRemarks =
      "가".repeat(
        1001
      );


    const changedSox =
      createInput({
        recordDate:
          "2026-09-01",
        unitNo:
          2,
        field:
          "soxPpm",
        value:
          "14.00",
        originalValue:
          "13.45"
      });


    const unchangedRemarks =
      createInput({
        recordDate:
          "2026-09-01",
        remarks:
          true,
        unitNos:
          "2",
        value:
          legacyRemarks,
        originalValue:
          legacyRemarks
      });


    const ui =
      createUiHarness({
        historyItems: [
          {
            recordDate:
              "2026-09-01",
            unitNo:
              2,
            soxPpm:
              13.45,
            remarks:
              legacyRemarks,
            revision:
              1
          }
        ],
        valueInputs: [
          changedSox
        ],
        remarksInputs: [
          unchangedRemarks
        ]
      });


    assert.deepEqual(
      plain(
        ui.collectAuxiliaryMaterialChangedRecords()
      ),
      [
        {
          recordDate:
            "2026-09-01",
          unitNo:
            2,
          revision:
            1,
          values: {
            soxPpm:
              14
          },
          remarksChanged:
            false,
          changedFields: [
            "soxPpm"
          ]
        }
      ]
    );
  }
);


function createD1Database() {
  const sqlite =
    new DatabaseSync(
      ":memory:"
    );


  let beforeBatch =
    null;


  const database = {
    prepare(sql) {
      const statement = {
        values: [],

        bind(...values) {
          this.values =
            values;

          return this;
        },

        async first() {
          return sqlite
            .prepare(
              sql
            )
            .get(
              ...this.values
            ) ||
            null;
        },

        async all() {
          return {
            results:
              sqlite
                .prepare(
                  sql
                )
                .all(
                  ...this.values
                )
          };
        },

        async run() {
          const result =
            sqlite
              .prepare(
                sql
              )
              .run(
                ...this.values
              );


          return {
            meta: {
              changes:
                Number(
                  result.changes
                )
            }
          };
        }
      };


      return statement;
    },

    async batch(statements) {
      if (
        beforeBatch
      ) {
        const callback =
          beforeBatch;


        beforeBatch =
          null;


        await callback(
          sqlite
        );
      }


      sqlite.exec(
        "BEGIN IMMEDIATE"
      );


      try {
        const results = [];


        for (const statement of statements) {
          results.push(
            await statement.run()
          );
        }


        sqlite.exec(
          "COMMIT"
        );


        return results;

      } catch (error) {
        sqlite.exec(
          "ROLLBACK"
        );

        throw error;
      }
    }
  };


  return {
    sqlite,
    database,

    setBeforeBatch(callback) {
      beforeBatch =
        callback;
    }
  };
}


const AUTH_TOKEN =
  "auxiliary-material-edit-test-token";


async function createApiFixture() {
  const fixture =
    createD1Database();


  fixture.sqlite.exec(`
    CREATE TABLE users (
      employee_no TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );

    CREATE TABLE shift_log_sessions (
      token_hash TEXT PRIMARY KEY,
      employee_no TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );
  `);


  fixture.sqlite
    .prepare(
      "INSERT INTO users VALUES (?, ?, ?, ?)"
    )
    .run(
      "operator-1",
      "시험 사용자",
      "user",
      1
    );


  fixture.sqlite
    .prepare(
      "INSERT INTO shift_log_sessions VALUES (?, ?, ?, ?)"
    )
    .run(
      createHash(
        "sha256"
      )
        .update(
          AUTH_TOKEN
        )
        .digest(
          "hex"
        ),
      "operator-1",
      "2099-01-01T00:00:00.000Z",
      new Date()
        .toISOString()
    );


  await __oisDataRequestsTest
    .ensureAuxiliaryMaterialDailyTable(
      fixture.database
    );


  fixture.sqlite
    .prepare(`
      INSERT INTO auxiliary_material_daily (
        id,
        record_date,
        unit_no,
        limestone_receipt_ton,
        limestone_usage_tpd,
        lime_slurry_flow_m3h,
        lime_slurry_density_kgm3,
        lime_powder_tpd,
        ammonia_flow_m3h,
        ammonia_m3d,
        sox_ppm,
        nox_ppm,
        remarks,
        created_at,
        updated_at,
        revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "aux-20260901-2",
      "2026-09-01",
      2,
      61.05,
      34.76,
      0.919,
      1068,
      2.36,
      0,
      0,
      13.45,
      -0.04,
      "기존 비고",
      "2026-09-01T00:10:00.000Z",
      "2026-09-01T00:10:00.000Z",
      1
    );


  return fixture;
}


async function postEdits(
  database,
  items
) {
  const request =
    new Request(
      "https://shift.test/api/ois-data-requests",
      {
        method:
          "POST",
        headers: {
          Authorization:
            `Bearer ${AUTH_TOKEN}`,
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify({
            action:
              "update_auxiliary_material_rows",
            items
          })
      }
    );


  const response =
    await onRequestPost({
      request,
      env: {
        DB:
          database
      }
    });


  return {
    status:
      response.status,
    body:
      await response.json()
  };
}


async function postEdit(
  database,
  item
) {
  return postEdits(
    database,
    [
      item
    ]
  );
}


function readAuxiliaryRow(
  sqlite
) {
  return sqlite
    .prepare(
      (
        "SELECT * FROM auxiliary_material_daily " +
        "WHERE record_date = '2026-09-01' AND unit_no = 2"
      )
    )
    .get();
}


test(
  "API merges sparse edits with authoritative DB values and preserves negative NOx and remarks",
  async () => {
    const fixture =
      await createApiFixture();


    try {
      const numericResult =
        await postEdit(
          fixture.database,
          {
            recordDate:
              "2026-09-01",
            unitNo:
              2,
            revision:
              1,
            changedFields: [
              "soxPpm"
            ],
            values: {
              soxPpm:
                14.25
            },
            remarksChanged:
              false
          }
        );


      assert.equal(
        numericResult.status,
        200,
        numericResult.body.message
      );


      let row =
        readAuxiliaryRow(
          fixture.sqlite
        );


      assert.equal(
        row.sox_ppm,
        14.25
      );
      assert.equal(
        row.nox_ppm,
        -0.04
      );
      assert.equal(
        row.remarks,
        "기존 비고"
      );
      assert.equal(
        row.revision,
        2
      );


      const remarksResult =
        await postEdit(
          fixture.database,
          {
            recordDate:
              "2026-09-01",
            unitNo:
              2,
            revision:
              2,
            changedFields: [],
            values: {},
            remarksChanged:
              true,
            remarks:
              "수정 비고"
          }
        );


      assert.equal(
        remarksResult.status,
        200,
        remarksResult.body.message
      );


      row =
        readAuxiliaryRow(
          fixture.sqlite
        );


      assert.equal(
        row.nox_ppm,
        -0.04
      );
      assert.equal(
        row.remarks,
        "수정 비고"
      );
      assert.equal(
        row.revision,
        3
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "API rejects a newly edited negative value, sparse-field mismatch and stale revision without writes",
  async () => {
    const fixture =
      await createApiFixture();


    try {
      for (const item of [
        {
          recordDate:
            "2026-09-01",
          unitNo:
            2,
          revision:
            1,
          changedFields: [
            "noxPpm"
          ],
          values: {
            noxPpm:
              -0.05
          },
          remarksChanged:
            false
        },
        {
          recordDate:
            "2026-09-01",
          unitNo:
            2,
          revision:
            1,
          changedFields: [
            "soxPpm"
          ],
          values: {
            soxPpm:
              14,
            noxPpm:
              -999
          },
          remarksChanged:
            false
        }
      ]) {
        const before =
          JSON.stringify(
            readAuxiliaryRow(
              fixture.sqlite
            )
          );


        const result =
          await postEdit(
            fixture.database,
            item
          );


        assert.equal(
          result.status,
          400
        );
        assert.equal(
          JSON.stringify(
            readAuxiliaryRow(
              fixture.sqlite
            )
          ),
          before
        );
      }


      const stale =
        await postEdit(
          fixture.database,
          {
            recordDate:
              "2026-09-01",
            unitNo:
              2,
            revision:
              99,
            changedFields: [
              "soxPpm"
            ],
            values: {
              soxPpm:
                14
            },
            remarksChanged:
              false
          }
        );


      assert.equal(
        stale.status,
        409
      );
      assert.equal(
        readAuxiliaryRow(
          fixture.sqlite
        ).revision,
        1
      );


      const corrected =
        await postEdit(
          fixture.database,
          {
            recordDate:
              "2026-09-01",
            unitNo:
              2,
            revision:
              1,
            changedFields: [
              "noxPpm"
            ],
            values: {
              noxPpm:
                0
            },
            remarksChanged:
              false
          }
        );


      assert.equal(
        corrected.status,
        200,
        corrected.body.message
      );
      assert.equal(
        readAuxiliaryRow(
          fixture.sqlite
        ).nox_ppm,
        0
      );


    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "API rejects incomplete sparse controls and non-positive revisions without writes",
  async () => {
    const fixture =
      await createApiFixture();


    try {
      const invalidItems = [
        {
          recordDate:
            "2026-09-01",
          unitNo:
            2,
          changedFields: [
            "soxPpm"
          ],
          values: {
            soxPpm:
              14
          },
          remarksChanged:
            false
        },
        {
          recordDate:
            "2026-09-01",
          unitNo:
            2,
          revision:
            0,
          changedFields: [
            "soxPpm"
          ],
          values: {
            soxPpm:
              14
          },
          remarksChanged:
            false
        },
        {
          recordDate:
            "2026-09-01",
          unitNo:
            2,
          revision:
            "1",
          changedFields: [
            "soxPpm"
          ],
          values: {
            soxPpm:
              14
          },
          remarksChanged:
            false
        },
        {
          recordDate:
            "2026-09-01",
          unitNo:
            2,
          revision:
            1,
          values: {},
          remarksChanged:
            true,
          remarks:
            "혼합 요청"
        },
        {
          recordDate:
            "2026-09-01",
          unitNo:
            2,
          revision:
            1,
          changedFields: [],
          values: {},
          remarksChanged:
            true
        }
      ];


      for (const item of invalidItems) {
        const before =
          JSON.stringify(
            readAuxiliaryRow(
              fixture.sqlite
            )
          );


        const result =
          await postEdit(
            fixture.database,
            item
          );


        assert.equal(
          result.status,
          400
        );
        assert.equal(
          JSON.stringify(
            readAuxiliaryRow(
              fixture.sqlite
            )
          ),
          before
        );
      }

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "API revision guard rejects an interleaved update and rolls back every sibling edit",
  async () => {
    const fixture =
      await createApiFixture();


    try {
      fixture.sqlite
        .prepare(`
          INSERT INTO auxiliary_material_daily (
            id,
            record_date,
            unit_no,
            limestone_usage_tpd,
            lime_powder_tpd,
            ammonia_m3d,
            sox_ppm,
            nox_ppm,
            remarks,
            created_at,
            updated_at,
            revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          "aux-20260901-1",
          "2026-09-01",
          1,
          20,
          2,
          1,
          10,
          2,
          "1호기 기존",
          "2026-09-01T00:10:00.000Z",
          "2026-09-01T00:10:00.000Z",
          1
        );


      fixture.setBeforeBatch(
        sqlite => {
          sqlite
            .prepare(`
              UPDATE auxiliary_material_daily

              SET
                sox_ppm = 99,
                revision = revision + 1

              WHERE
                record_date = '2026-09-01'
                AND unit_no = 2
            `)
            .run();
        }
      );


      const result =
        await postEdits(
          fixture.database,
          [
            {
              recordDate:
                "2026-09-01",
              unitNo:
                2,
              revision:
                1,
              changedFields: [
                "limestoneUsageTpd"
              ],
              values: {
                limestoneUsageTpd:
                  35
              },
              remarksChanged:
                false
            },
            {
              recordDate:
                "2026-09-01",
              unitNo:
                1,
              revision:
                1,
              changedFields: [
                "soxPpm"
              ],
              values: {
                soxPpm:
                  11
              },
              remarksChanged:
                false
            }
          ]
        );


      assert.equal(
        result.status,
        409
      );


      const unitTwo =
        readAuxiliaryRow(
          fixture.sqlite
        );


      assert.equal(
        unitTwo.sox_ppm,
        99
      );
      assert.equal(
        unitTwo.limestone_usage_tpd,
        34.76
      );
      assert.equal(
        unitTwo.revision,
        2
      );


      const unitOne =
        fixture.sqlite
          .prepare(`
            SELECT *

            FROM auxiliary_material_daily

            WHERE
              record_date = '2026-09-01'
              AND unit_no = 1
          `)
          .get();


      assert.equal(
        unitOne.sox_ppm,
        10
      );
      assert.equal(
        unitOne.revision,
        1
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "API preserves an untouched legacy long remark during a sparse numeric edit",
  async () => {
    const fixture =
      await createApiFixture();


    try {
      const legacyRemarks =
        "가".repeat(
          1001
        );


      fixture.sqlite
        .prepare(`
          UPDATE auxiliary_material_daily

          SET remarks = ?

          WHERE
            record_date = '2026-09-01'
            AND unit_no = 2
        `)
        .run(
          legacyRemarks
        );


      const result =
        await postEdit(
          fixture.database,
          {
            recordDate:
              "2026-09-01",
            unitNo:
              2,
            revision:
              1,
            changedFields: [
              "soxPpm"
            ],
            values: {
              soxPpm:
                14
            },
            remarksChanged:
              false
          }
        );


      assert.equal(
        result.status,
        200,
        result.body.message
      );
      assert.equal(
        readAuxiliaryRow(
          fixture.sqlite
        ).remarks,
        legacyRemarks
      );


      fixture.sqlite
        .prepare(`
          UPDATE auxiliary_material_daily

          SET nox_ppm = 0

          WHERE
            record_date = '2026-09-01'
            AND unit_no = 2
        `)
        .run();


      const legacyResult =
        await postEdit(
          fixture.database,
          {
            recordDate:
              "2026-09-01",
            unitNo:
              2,
            revision:
              2,
            values: {
              limestoneReceiptTon:
                61.05,
              limestoneUsageTpd:
                34.76,
              limeSlurryFlowM3h:
                0.919,
              limeSlurryDensityKgm3:
                1068,
              limePowderTpd:
                2.36,
              ammoniaM3d:
                0,
              soxPpm:
                14,
              noxPpm:
                0
            }
          }
        );


      assert.equal(
        legacyResult.status,
        200,
        legacyResult.body.message
      );
      assert.equal(
        readAuxiliaryRow(
          fixture.sqlite
        ).remarks,
        legacyRemarks
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "cache keys and invalid-cell styling ship together",
  () => {
    const html =
      readFileSync(
        new URL(
          "../index.html",
          import.meta.url
        ),
        "utf8"
      );


    const css =
      readFileSync(
        new URL(
          "../style.css",
          import.meta.url
        ),
        "utf8"
      );


    assert.match(
      html,
      /style\.css\?v=20260916-aux-edit-validation-v1/
    );
    assert.match(
      html,
      /script\.js\?v=20260916-aux-edit-validation-v1/
    );
    assert.match(
      css,
      /\.auxiliary-material-value-input\.is-invalid/
    );
    assert.match(
      css,
      /rgba\(217, 45, 32, 0\.18\)/
    );
  }
);
