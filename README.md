# 알림봄 (시연용 프로토타입)

## 설치 없이 링크로 쓰기 (폰/PC 공통)
1. GitHub 저장소에 이 폴더 전체를 올립니다(main 브랜치).
2. 저장소 Settings → Pages → Source 를 **GitHub Actions** 로 선택합니다.
3. Actions 탭에서 'Deploy Web App' 이 끝나면 `https://<아이디>.github.io/<저장소이름>/` 주소로 접속됩니다.
4. 폰 크롬: 메뉴 → '홈 화면에 추가' 하면 앱처럼 실행됩니다.

## APK 만드는 방법 (가장 쉬운 방법: GitHub Actions)
1. GitHub에서 새 저장소를 만들고 이 폴더 전체를 업로드(push)합니다. (`.github` 폴더 포함)
2. 저장소의 **Actions → Build APK → Run workflow** 실행 (push하면 자동 실행)
3. 완료 후 **Artifacts → alrimbom-apk** 를 내려받아 압축을 풀면 `app-debug.apk`
4. 안드로이드 폰으로 옮겨 설치 (설정에서 '출처를 알 수 없는 앱 설치' 허용 필요)

## PC에서 직접 빌드 (Android Studio + Node 설치 필요)
```
npm install
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```
결과: android/app/build/outputs/apk/debug/app-debug.apk

## 바로 체험 (APK 없이)
www/index.html 을 휴대폰 크롬에서 열거나, 웹에 올린 뒤 '홈 화면에 추가'.

## 복지관 뉴스 자동 표시 (Netlify 서버 함수)
`netlify/functions/news.js` 가 복지관 이름으로 최신 뉴스를 찾아 앱에 보내 줍니다. (무료)
Netlify 드래그&드롭 배포에서는 함수가 동작하지 않을 수 있어, **GitHub 연결 배포**를 사용하세요.

1. 이 폴더 전체(`netlify.toml`, `netlify` 폴더, `www` 폴더 포함)를 GitHub 저장소에 올립니다.
2. Netlify → Add new site → Import an existing project → GitHub 저장소 선택
3. 설정은 그대로 두면 됩니다. (`netlify.toml` 에 publish=`www`, functions=`netlify/functions` 가 적혀 있음)
4. 배포가 끝나면 `https://사이트이름.netlify.app/.netlify/functions/news?q=안양시` 를 열어 JSON이 나오면 성공입니다.
5. APK에서도 쓰려면 `www/app.html` 의 `API_BASE` 에 적힌 주소를 내 Netlify 주소로 바꿉니다.

## 복지관 공지사항 자동 표시 (추가됨)
`netlify/functions/notices.js` 가 복지관 **이름만으로** 홈페이지를 찾아 공지사항 게시판의 최신 글을 앱에 보내 줍니다.
- 위 Netlify 배포 방법 그대로 쓰면 됩니다. (함수 파일만 하나 늘었어요)
- 확인: `https://사이트이름.netlify.app/.netlify/functions/notices?q=안양시관악장애인종합복지관` 을 열어 JSON이 나오면 성공
- (선택) 홈페이지 검색을 더 안정적으로: Netlify → Site configuration → Environment variables 에 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 추가
- 자동으로 못 찾는 복지관은 앱의 "내 복지관 → 🔗 홈페이지 주소 넣기"로 직접 알려 주면 됩니다.

## 복지관 소식 (공지사항 · 채용공고 · 뉴스)
학부모 화면의 "복지관 소식" 탭에는 검색·등록 기능이 없고, **복지관 고르기** 버튼으로 돌봄교사가 등록해 둔 복지관 중 하나를 고릅니다.
복지관을 고르면 📢 공지사항 / 🙋 참여자 모집 / 💼 채용공고 / 🗞️ 뉴스 탭이 나오고, 게시글이 카드(제목 · 작성자 · 날짜 · 조회수, 공지/마감/NEW 표시)로 보입니다.

### 돌봄교사가 복지관 추가하기 (앱 화면에서)
돌봄교사 모드 → 복지관 소식 → 맨 아래 **복지관 관리**에서 이름 + 공지사항(또는 홈페이지) 주소 + (선택) 참여자 모집 · 채용공고 게시판 주소를 넣고 등록합니다.
등록한 복지관은 학부모 화면의 "복지관 고르기"에 나타납니다. (같은 기기/같은 브라우저 기준 — 아래 참고)

### 모든 학부모에게 항상 보이게 하려면 (코드에 고정)
`www/app.html` 에서 `const PRESET=[` 를 찾아 복지관을 추가하세요. 코드에 넣은 복지관은 모든 기기에 나옵니다.
```
{name:'안양시○○장애인복지관',preset:true,boards:[
  {k:'notice',label:'공지사항',url:'https://.../board.php?bo_table=notice',fixed:true},
  {k:'recruit',label:'참여자 모집',url:'https://.../board.php?bo_table=recruit_user',fixed:true},
  {k:'job',label:'채용공고',url:'https://.../board.php?bo_table=○○○',fixed:true}]},
```
- 수정 후 GitHub에 올리면 Netlify/Pages가 자동으로 다시 배포합니다.
- 게시판 목록 읽기는 Netlify 함수 `notices.js` 가 합니다. (`fixed:true` = 그 주소의 게시판을 그대로 읽음)

> 참고: 앱 데이터는 기기(localStorage)에 저장되는 시연용 구조라서, 돌봄교사 폰에서 등록한 복지관이 다른 학부모 폰에 자동으로 전달되지는 않습니다. 실제 배포에서는 위 PRESET 방식을 쓰거나 서버 저장을 붙여야 해요.

### 복지관 홈페이지가 서버 접속을 막을 때 (http 403)
일부 복지관 홈페이지는 Netlify 같은 서버의 자동 접속을 막습니다. 이럴 때 두 가지 방법이 있어요.
1. **설치한 앱(APK)**: 휴대폰이 직접 홈페이지에 접속해서 목록을 읽어요. (서버를 거치지 않아요)
2. **돌봄교사 붙여넣기**: 돌봄교사 모드 → 복지관 소식 → 목록이 비어 있는 탭의 **✂️ 홈페이지 목록 복사해서 붙여넣기**.
   게시판 목록 표를 복사해서 붙여넣으면 학부모 화면에 같은 카드 모양으로 보여요. (웹/PC 시연에서도 항상 동작)

### 링크로 접속하는 모든 사람에게 복지관 소식 보이게 하기 (중요)
돌봄교사가 앱에서 등록한 복지관과 붙여넣은 목록은 **그 기기의 브라우저에만 저장**됩니다. 주소(링크)를 공유해도 받은 사람에게는 보이지 않아요.
모두에게 보이게 하려면:
1. 돌봄교사 모드 → 복지관 소식 → 맨 아래 **📤 모두에게 공유하기 (data.json 만들기)** 를 눌러요. (data.json 이 내려받아져요)
2. 그 파일로 저장소의 `www/data.json` 을 바꿔서 GitHub에 올려요. (Netlify가 자동으로 다시 배포)
3. 배포가 끝나면 링크로 접속한 모든 사람에게 복지관과 목록이 보여요. 목록을 새로 붙여넣을 때마다 1~2를 반복해요.
- 기본 복지관은 `PRESET` 에 넣으면 data.json 없이도 항상 보여요.


## APK에서 음성 읽기 (TTS)
APK 안의 WebView에는 웹 음성 기능이 없어서 `@capacitor-community/text-to-speech` 플러그인(기기 내장 TTS)을 사용합니다.
- 저장소에 올리면 GitHub Actions가 플러그인을 설치하고 APK를 다시 만듭니다. (기존 APK는 지우고 새로 설치)
- 소리가 안 나면: 탭 설정 → 일반 → 텍스트 음성 변환 출력에서 한국어 음성이 설치·선택돼 있는지 확인
