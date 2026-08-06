"use strict";

const {
  chromium
} = require(
  "playwright"
);


async function loginOis() {
  const userId =
    String(
      process.env.OIS_ID ||
      ""
    ).trim();


  const password =
    String(
      process.env.OIS_PASSWORD ||
      ""
    );


  if (
    !userId ||
    !password
  ) {
    throw new Error(
      "OIS_ID와 OIS_PASSWORD 환경변수를 설정해 주세요."
    );
  }


  const browser =
    await chromium.launch({
      headless:
        false,

      slowMo:
        100
    });


  const context =
    await browser.newContext();


  const page =
    await context.newPage();


  try {
    await page.goto(
      "http://ois.gspoge.com/jsp/login/index",
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          30000
      }
    );


    const userIdInput =
      page.locator(
        "#userid input"
      );


    const passwordInput =
      page.locator(
        "#pw input"
      );


    await userIdInput.waitFor({
      state:
        "visible",

      timeout:
        15000
    });


    await userIdInput.fill(
      userId
    );


    await passwordInput.fill(
      password
    );


    /*
      우선 비밀번호 입력칸에서 Enter로 로그인한다.
      실제 사이트 JavaScript가 암호화 후 요청을 보낸다.
    */
    await passwordInput.press(
      "Enter"
    );


    /*
      로그인 화면 전환 대기
    */
    await page.waitForTimeout(
      4000
    );


    console.log(
      "현재 주소:",
      page.url()
    );


    /*
      로그인 세션을 파일로 저장한다.
      다음 실행에서 재로그인 없이 사용할 수 있다.
    */
    await context.storageState({
      path:
        "ois-session.json"
    });


    console.log(
      "OIS 로그인 시도를 완료했습니다."
    );


    /*
      테스트 중 화면이 바로 닫히지 않게 유지
    */
    await page.waitForTimeout(
      60000
    );

  } catch (
    error
  ) {
    console.error(
      "OIS 로그인 오류:",
      error
    );


    await page.screenshot({
      path:
        "ois-login-error.png",

      fullPage:
        true
    });


    throw error;

  } finally {
    await browser.close();
  }
}


loginOis()
  .catch(
    error => {
      console.error(
        error.message
      );


      process.exitCode =
        1;
    }
  );