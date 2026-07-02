import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

// ============================================================================
// Lightweight i18n — English is the DEFAULT language, Korean is a toggle.
// All UI labels (menu, forms, tables) default to English.
// ============================================================================

export type Lang = 'en' | 'ko';

type Entry = { en: string; ko: string };

const DICT = {
  // --- App shell / nav ------------------------------------------------------
  'app.brandSub': { en: 'Attendance · Payroll System', ko: '출퇴근 · 급여관리 시스템' },
  'app.loading': { en: 'Loading...', ko: '로딩 중...' },
  'app.payPeriod': { en: 'Pay period', ko: '급여기간' },
  'app.weekly': { en: 'weekly', ko: '주' },
  'app.monthly': { en: 'monthly', ko: '월' },
  'app.role': { en: 'Payroll Admin', ko: '급여 담당' },
  'nav.dashboard': { en: 'Dashboard', ko: '대시보드' },
  'nav.attendance': { en: 'Attendance', ko: '출퇴근 입력' },
  'nav.payroll': { en: 'Payroll', ko: '급여표' },
  'nav.payslip': { en: 'Payslip', ko: '급여명세서' },
  'nav.employees': { en: 'Employees', ko: '인부 관리' },
  'nav.skills': { en: 'Skills', ko: '멀티 스킬' },
  'nav.tasks': { en: 'Task Assign', ko: '작업 배정' },
  'nav.units': { en: 'Unit Progress', ko: '층별 공정' },
  'nav.materials': { en: 'Materials', ko: '자재 구매' },
  'nav.matReady': { en: 'Material Readiness', ko: '자재 준비 현황' },
  'nav.settings': { en: 'Settings', ko: '규칙 설정' },

  // --- Skills matrix --------------------------------------------------------
  'skill.title': {
    en: 'Multi-Skill Matrix — proficiency by trade (0–10)',
    ko: '멀티 스킬 매트릭스 — 직종별 숙련도 (0~10점)',
  },
  'skill.search': { en: 'Search name…', ko: '성명 검색…' },
  'skill.save': { en: 'Save', ko: '저장' },
  'skill.saving': { en: 'Saving…', ko: '저장 중…' },
  'skill.saved': { en: 'Skill scores saved.', ko: '스킬 점수가 저장되었습니다.' },
  'skill.saveError': { en: 'Failed to save skill scores.', ko: '스킬 점수 저장에 실패했습니다.' },
  'skill.export': { en: 'Export Excel', ko: '엑셀 내보내기' },
  'skill.unsaved': { en: 'unsaved', ko: '미저장' },
  'skill.thName': { en: 'Name', ko: '성명' },
  'skill.thCrew': { en: 'Crew', ko: '조' },
  'skill.thAvg': { en: 'Avg', ko: '평균' },
  'skill.thPhoto': { en: 'Photo', ko: '사진' },
  'skill.thAge': { en: 'Age', ko: '나이' },
  'skill.thId': { en: 'ID', ko: '아이디' },
  'skill.photoTitle': { en: 'Upload / take ID photo', ko: '증명사진 업로드 / 촬영' },
  'skill.photoError': { en: 'Failed to upload photo.', ko: '사진 업로드에 실패했습니다.' },
  'skill.printSignup': { en: 'Print sign-up sheet', ko: '사인업 시트 인쇄' },
  'skill.signupTitle': { en: 'BRIGHTEM — Skill Sign-up Sheet', ko: 'BRIGHTEM — 스킬 사인업 시트' },
  'skill.printBtn': { en: 'Print', ko: '인쇄' },
  'skill.printHint': {
    en: 'One page per crew · photo + age + ID · fill skills 0–10 by hand · A4 landscape',
    ko: '조별 한 장 · 사진＋나이＋아이디 · 스킬 0–10 손으로 기입 · A4 가로',
  },
  'skill.popupBlocked': {
    en: 'Popup blocked. Please allow popups to print.',
    ko: '팝업이 차단되었습니다. 인쇄하려면 팝업을 허용해 주세요.',
  },
  'skill.note': {
    en: '※ 0 = not rated, 1–10 = proficiency. Edits are saved to the database. Trades can be added later.',
    ko: '※ 0 = 미평가, 1~10 = 숙련도. 수정 내용은 데이터베이스에 저장됩니다. 직종은 추후 추가할 수 있습니다.',
  },
  'skill.tile': { en: 'Tile', ko: '타일' },
  'skill.carpentry': { en: 'Carpentry', ko: '목수' },
  'skill.plastering': { en: 'Plastering', ko: '미장' },
  'skill.paint': { en: 'Paint', ko: '페인트' },
  'skill.scaffolding': { en: 'Scaffolding', ko: '스카폴딩' },
  'skill.pipe': { en: 'Pipe', ko: '파이프' },
  'skill.window_frame': { en: 'Window frame', ko: '창호 프레임' },
  'skill.window_glass': { en: 'Window glass', ko: '유리' },
  'skill.plumbing': { en: 'Plumbing (restrooms)', ko: '배관(화장실)' },
  'skill.roofing': { en: 'Roof framing/roofing', ko: '지붕 골조/방수' },
  'skill.fire_protection': { en: 'Fire protection', ko: '소방' },
  'skill.wall_panel': { en: 'Interior wall panels', ko: '내부 벽 패널' },
  'skill.fire_chase_seal': {
    en: 'Fire chase sealing/concreting (restroom)',
    ko: '화장실 소방배관구(파이어체이스) 실링/콘크리트',
  },

  // --- Task assignment ------------------------------------------------------
  'task.title': {
    en: 'Task Assignment — plan work the day before, auto-match by attendance',
    ko: '작업 배정 — 전일 작업 등록, 당일 출근 기준 자동 매칭',
  },
  'task.workDate': { en: 'Work date:', ko: '작업일:' },
  'task.planTitle': { en: 'Planned Tasks (registered the day before)', ko: '작업 계획 (전일 등록)' },
  'task.addTask': { en: '+ Add Task', ko: '+ 작업 추가' },
  'task.thName': { en: 'Task', ko: '작업명' },
  'task.thTrade': { en: 'Trade', ko: '직종' },
  'task.thManday': { en: 'Man-days (공수)', ko: '필요공수 (인·일)' },
  'task.thHeadcount': { en: 'Headcount', ko: '필요인원' },
  'task.thEndDate': { en: 'Est. finish', ko: '예상 완료일' },
  'task.durationDays': { en: 'days', ko: '일' },
  'task.progressTitle': { en: 'Work progress', ko: '작업 진행 현황' },
  'task.pgPending': { en: 'Pending', ko: '대기' },
  'task.pgInProgress': { en: 'In progress', ko: '진행중' },
  'task.pgDone': { en: 'Done', ko: '완료' },
  'task.pgTotal': { en: 'total', ko: '전체' },
  'task.pgStart': { en: '▶ Start work', ko: '▶ 진행 시작' },
  'task.pgComplete': { en: '✓ Mark complete', ko: '✓ 완료 처리' },
  'task.pgToPending': { en: 'Back to pending', ko: '대기로' },
  'task.pgReopen': { en: '↺ Reopen', ko: '↺ 되돌리기' },
  'task.thStatus': { en: 'Status', ko: '상태' },
  'task.thActions': { en: '', ko: '' },
  'task.stDraft': { en: 'Draft', ko: '작성중' },
  'task.stClosed': { en: 'Closed', ko: '마감' },
  'task.newTaskName': { en: 'New task name', ko: '새 작업명' },
  'task.close': { en: 'Close', ko: '마감' },
  'task.reopen': { en: 'Reopen', ko: '재개' },
  'task.delete': { en: 'Delete', ko: '삭제' },
  'task.save': { en: 'Save Plan', ko: '계획 저장' },
  'task.saving': { en: 'Saving…', ko: '저장 중…' },
  'task.saved': { en: 'Task plan saved.', ko: '작업 계획이 저장되었습니다.' },
  'task.saveError': { en: 'Failed to save task plan.', ko: '작업 계획 저장에 실패했습니다.' },
  'task.noTasks': { en: 'No tasks planned for this day. Add one above.', ko: '이 날짜에 등록된 작업이 없습니다. 위에서 추가하세요.' },
  'task.matchTitle': { en: 'Auto-Match — present workers → tasks (highest skill first)', ko: '자동 매칭 — 당일 출근자 → 작업 (스킬 점수 높은 순)' },
  'task.runMatch': { en: 'Run Auto-Match', ko: '자동 매칭 실행' },
  'task.saveAssign': { en: 'Save Assignments', ko: '배정 저장' },
  'task.assignSaved': { en: 'Assignments saved.', ko: '배정이 저장되었습니다.' },
  'task.assignError': { en: 'Failed to save assignments.', ko: '배정 저장에 실패했습니다.' },
  'task.present': { en: 'Present today', ko: '당일 출근' },
  'task.assigned': { en: 'Assigned', ko: '배정됨' },
  'task.unassigned': { en: 'Unassigned (standby)', ko: '미배정 (대기)' },
  'task.thWorker': { en: 'Worker', ko: '인부' },
  'task.thSkill': { en: 'Skill', ko: '스킬점수' },
  'task.needMatch': { en: 'Run auto-match to place present workers on tasks.', ko: '자동 매칭을 실행하면 출근자가 작업에 배치됩니다.' },
  'task.noPresent': { en: 'No workers are marked present on this date.', ko: '이 날짜에 출근으로 표시된 인부가 없습니다.' },
  'task.filled': { en: 'filled', ko: '충원' },
  'task.note': {
    en: '※ Man-day (인·일) = total person-days of work. Est. finish = start date + ⌈man-days ÷ headcount⌉ working days. Auto-match fills each task up to its headcount using present workers, choosing the highest skill score for the task\'s trade first.',
    ko: '※ 공수(인·일) = 총 투입 person-day. 예상 완료일 = 시작일 + ⌈공수 ÷ 필요인원⌉ 작업일. 자동 매칭은 당일 출근자 중 해당 직종 스킬 점수가 높은 사람부터 필요인원만큼 각 작업에 배치합니다.',
  },
  'task.assignTarget': { en: 'Assign clicked worker to:', ko: '클릭한 인부를 배정할 작업:' },
  'task.clickHint': { en: '(click a standby worker below to place them here)', ko: '(아래 대기 인부를 클릭하면 이 작업에 배정됩니다)' },
  'task.clickToAssign': { en: 'Click to assign to the selected task', ko: '클릭하면 선택된 작업에 배정' },
  'task.clickToRemove': { en: 'Click to send back to standby', ko: '클릭하면 대기로 되돌리기' },
  'task.manualNote': {
    en: '※ You can also assign manually: pick a target task above, then click any standby worker to place them. Click an assigned worker to remove them.',
    ko: '※ 수동 배정도 가능합니다: 위에서 대상 작업을 선택한 뒤 대기 인부를 클릭하면 배정되고, 배정된 인부를 클릭하면 대기로 돌아갑니다.',
  },

  // --- Material purchase request --------------------------------------------
  'mat.title': {
    en: 'Material Purchase Requests',
    ko: '자재 구매 요청서',
  },
  'mat.newRequest': { en: '+ New Request', ko: '+ 새 요청서' },
  'mat.listTitle': { en: 'Requests', ko: '요청서 목록' },
  'mat.thNo': { en: 'Req No.', ko: '요청번호' },
  'mat.thDate': { en: 'Date', ko: '요청일' },
  'mat.thRequester': { en: 'Requester', ko: '요청자' },
  'mat.thSite': { en: 'Site', ko: '현장' },
  'mat.thItems': { en: 'Items', ko: '품목수' },
  'mat.thTotal': { en: 'Est. Total', ko: '예상합계' },
  'mat.thStatus': { en: 'Status', ko: '상태' },
  'mat.thActions': { en: '', ko: '' },
  'mat.noRequests': { en: 'No requests yet. Create one above.', ko: '등록된 요청서가 없습니다. 위에서 추가하세요.' },
  'mat.edit': { en: 'Edit', ko: '편집' },
  'mat.delete': { en: 'Delete', ko: '삭제' },
  'mat.editorNew': { en: 'New Purchase Request', ko: '새 구매 요청서' },
  'mat.editorEdit': { en: 'Edit Purchase Request', ko: '구매 요청서 편집' },
  'mat.fldNo': { en: 'Request No.', ko: '요청번호' },
  'mat.fldDate': { en: 'Request Date', ko: '요청일' },
  'mat.fldRequester': { en: 'Requester', ko: '요청자' },
  'mat.fldSite': { en: 'Site / Area', ko: '현장 / 구역' },
  'mat.fldNeededBy': { en: 'Needed By', ko: '납기일' },
  'mat.fldTask': { en: 'Linked Task', ko: '연동 작업' },
  'mat.fldTaskNone': { en: '— none —', ko: '— 없음 —' },
  'mat.fldNote': { en: 'Note', ko: '비고' },
  'mat.itemsTitle': { en: 'Material Items', ko: '자재 품목' },
  'mat.addItem': { en: '+ Add Item', ko: '+ 품목 추가' },
  'mat.itName': { en: 'Material', ko: '자재명' },
  'mat.itSpec': { en: 'Spec', ko: '규격' },
  'mat.itQty': { en: 'Qty', ko: '수량' },
  'mat.itUnit': { en: 'Unit', ko: '단위' },
  'mat.itPrice': { en: 'Unit Price', ko: '단가' },
  'mat.itSupplier': { en: 'Supplier', ko: '공급처' },
  'mat.itAmount': { en: 'Amount', ko: '금액' },
  'mat.noItems': { en: 'No items. Add a material line above.', ko: '품목이 없습니다. 위에서 자재를 추가하세요.' },
  'mat.total': { en: 'Estimated Total', ko: '예상 합계' },
  'mat.save': { en: 'Save Request', ko: '요청서 저장' },
  'mat.saving': { en: 'Saving…', ko: '저장 중…' },
  'mat.saved': { en: 'Request saved.', ko: '요청서가 저장되었습니다.' },
  'mat.saveError': { en: 'Failed to save request.', ko: '요청서 저장에 실패했습니다.' },
  'mat.cancel': { en: 'Cancel', ko: '취소' },
  'mat.deleteConfirm': { en: 'Delete this request?', ko: '이 요청서를 삭제하시겠습니까?' },
  'mat.stRequested': { en: 'Requested', ko: '요청' },
  'mat.stApproved': { en: 'Approved', ko: '승인' },
  'mat.stRejected': { en: 'Rejected', ko: '반려' },
  'mat.approve': { en: 'Approve', ko: '승인' },
  'mat.reject': { en: 'Reject', ko: '반려' },
  'mat.reopen': { en: 'Reopen', ko: '요청상태로' },
  'mat.note': {
    en: '※ Register materials the day before, submit for approval, then the request is Approved or Rejected. Amounts are estimates for planning; actual PO prices may differ.',
    ko: '※ 전일에 자재를 등록하고 승인 요청하면 승인 또는 반려됩니다. 금액은 계획용 예상치이며 실제 발주가와 다를 수 있습니다.',
  },

  // --- Unit (room) finishing progress ---------------------------------------
  'unit.floorSuffix': { en: 'F', ko: '층' },
  'unit.diagramTitle': { en: 'Layout', ko: '배치도' },
  'unit.floorComplete': { en: 'Floor complete', ko: '층 완료율' },
  'unit.roomsDone': { en: 'Rooms done', ko: '완료 호실' },
  'unit.corridor': { en: 'Corridor', ko: '복도' },
  'unit.elevator': { en: 'Elevator', ko: '엘리베이터' },
  'unit.stairs': { en: 'Stairs', ko: '계단' },
  'unit.allFloors': { en: 'All floors', ko: '전체 층' },
  'unit.roomDetail': { en: 'Room', ko: '호실' },
  'unit.diagramHint': {
    en: 'Each room shows a 3×3 grid — one square per work item (order in the legend above). Click a room to open it.',
    ko: '각 방의 3×3 격자는 공정 9종을 순서대로(위 범례 순) 나타냅니다. 방을 클릭하면 상세가 열립니다.',
  },
  'unit.cycleHint': {
    en: 'Click a work item to cycle: Pending → In progress → Done.',
    ko: '공정을 클릭하면 대기 → 진행중 → 완료 순으로 바뀝니다.',
  },
  'unit.multiHint': {
    en: 'Tap rooms to select one or many, then set work status below.',
    ko: '방을 눌러 한 개 또는 여러 개를 선택한 뒤 아래에서 작업 상태를 반영하세요.',
  },
  'unit.selectedRooms': { en: 'rooms selected', ko: '개 호실 선택됨' },
  'unit.selectAll': { en: 'Select all', ko: '전체 선택' },
  'unit.clearSel': { en: 'Clear', ko: '선택 해제' },
  'unit.allItems': { en: 'All work items', ko: '전체 공정' },
  'unit.batchHint': {
    en: 'Pick a status to apply it to every selected room.',
    ko: '상태를 누르면 선택한 모든 호실에 일괄 적용됩니다.',
  },
  'unit.saveError': { en: 'Failed to save progress.', ko: '진행 상태 저장에 실패했습니다.' },
  'unit.st.pending': { en: 'Pending', ko: '대기' },
  'unit.st.in_progress': { en: 'In progress', ko: '진행중' },
  'unit.st.done': { en: 'Done', ko: '완료' },
  'unit.wi.xps': { en: 'XPS', ko: 'XPS(단열)' },
  'unit.wi.ceiling': { en: 'Ceiling', ko: '천장' },
  'unit.wi.pipe': { en: 'Pipe', ko: '파이프' },
  'unit.wi.electrical': { en: 'Electrical', ko: '전기' },
  'unit.wi.tile': { en: 'Tile', ko: '타일' },
  'unit.wi.waterproof': { en: 'Waterproofing', ko: '방수' },
  'unit.wi.window': { en: 'Windows', ko: '창호' },
  'unit.wi.wallpaper': { en: 'Wallpaper', ko: '도배' },
  'unit.wi.door': { en: 'Door', ko: '문' },

  // --- Material readiness (supply pipeline per floor) -----------------------
  'matr.title': {
    en: 'Material Readiness — supply pipeline by material and floor',
    ko: '자재 준비 현황 — 자재별 × 층별 공급 단계',
  },
  'matr.intro': {
    en: 'Track each material from purchase to delivery. Tap a cell to advance the stage.',
    ko: '각 자재를 구매부터 방 배달까지 추적합니다. 칸을 누르면 단계가 넘어갑니다.',
  },
  'matr.hint': {
    en: 'Tap a cell to advance: Not ordered → Ordered → Shipping → Out for delivery. Once out for delivery, tap to open the floor’s rooms and check off each delivered room.',
    ko: '칸을 누르면 진행됩니다: 미구매 → 구매 → 배송중 → 배달중. 배달중이 되면 칸을 눌러 해당 층의 방 목록을 열고 배달된 방을 하나씩 체크하세요.',
  },
  'matr.material': { en: 'Material', ko: '자재' },
  'matr.countPlaceholder': { en: 'qty / memo', ko: '개수/메모' },
  'matr.saveError': { en: 'Failed to save.', ko: '저장에 실패했습니다.' },
  'matr.roomsDelivered': { en: 'rooms delivered', ko: '개 방 배달 완료' },
  'matr.totalRoomsDelivered': { en: 'Rooms delivered', ko: '방 배달 완료' },
  'matr.deliverHint': {
    en: 'Tap rooms to select (several at once); tap again to deselect. Or drag across rooms to select/deselect many at once. Set their status and enter pieces + a memo. Tap 📷 on a room to add photos. All rooms delivered = Delivered.',
    ko: '방을 눌러 선택하세요(여러 개 동시 선택 가능). 다시 누르면 선택 해제됩니다. 또는 방 위를 드래그하면 여러 개를 한 번에 선택/해제할 수 있습니다. 선택한 방의 상태를 정하고 수량과 메모를 입력하세요. 방의 📷 를 누르면 사진을 추가할 수 있습니다. 모든 방이 배달되면 완료로 표시됩니다.',
  },
  'matr.selectAll': { en: 'Select all', ko: '전체 선택' },
  'matr.deselectAll': { en: 'Deselect all', ko: '전체 해제' },
  'matr.selectedCount': { en: 'selected', ko: '개 선택됨' },
  'matr.room': { en: 'Room', ko: '방' },
  'matr.pieces': { en: 'Pieces delivered', ko: '배달 수량(개)' },
  'matr.piecesUnit': { en: 'pcs', ko: '개' },
  'matr.memo': { en: 'Memo', ko: '메모' },
  'matr.memoPlaceholder': { en: 'e.g. left at the door', ko: '예: 문 앞에 둠' },
  'matr.markDelivered': { en: 'Mark delivered', ko: '배달 표시' },
  'matr.delivered': { en: 'Delivered', ko: '배달완료' },
  'matr.notDelivered': { en: 'Not yet', ko: '미배달' },
  'matr.ongoing': { en: 'On the way', ko: '배달중' },
  'matr.roomsSelected': { en: 'rooms selected', ko: '개 방 선택됨' },
  'matr.clearSelection': { en: 'Clear selection', ko: '선택 해제' },
  'matr.batchHint': {
    en: 'The status and values you set apply to all selected rooms.',
    ko: '설정한 상태와 값은 선택한 모든 방에 적용됩니다.',
  },
  'matr.allRooms': { en: 'All rooms', ko: '전체 방' },
  'matr.clearRooms': { en: 'Clear', ko: '해제' },
  'matr.backToShipping': { en: 'Back to shipping', ko: '배송 단계로' },
  'matr.close': { en: 'Close', ko: '닫기' },
  'matr.stage.pending': { en: 'Not ordered', ko: '미구매' },
  'matr.stage.ordered': { en: 'Ordered', ko: '구매' },
  'matr.stage.shipping': { en: 'Shipping', ko: '배송중' },
  'matr.stage.delivering': { en: 'Out for delivery', ko: '배달중' },
  'matr.stage.delivered': { en: 'Delivered', ko: '방 배달' },

  // --- Room photos ----------------------------------------------------------
  'photo.title': { en: 'Photos', ko: '사진' },
  'photo.add': { en: 'Add photo', ko: '사진 추가' },
  'photo.uploading': { en: 'Uploading…', ko: '업로드 중…' },
  'photo.loading': { en: 'Loading…', ko: '불러오는 중…' },
  'photo.empty': { en: 'No photos yet. Add one below.', ko: '아직 사진이 없습니다. 아래에서 추가하세요.' },
  'photo.count': { en: 'photo(s)', ko: '장' },
  'photo.close': { en: 'Close', ko: '닫기' },
  'photo.delete': { en: 'Delete', ko: '삭제' },
  'photo.deleteConfirm': { en: 'Delete this photo?', ko: '이 사진을 삭제할까요?' },
  'photo.deleteError': { en: 'Failed to delete photo.', ko: '사진 삭제에 실패했습니다.' },
  'photo.uploadError': { en: 'Failed to upload photo.', ko: '사진 업로드에 실패했습니다.' },

  // --- Dashboard ------------------------------------------------------------
  'dash.mockBanner': {
    en: 'This screen is a planning-stage mockup. Numbers are illustrative sample data; the real build connects to the database.',
    ko: '이 화면은 기획 단계 목업(mockup)입니다. 숫자는 실제 데이터를 예시로 표현한 것으로, 실제 개발 시 DB와 연동됩니다.',
  },
  'dash.registeredWorkers': { en: 'Registered Workers', ko: '등록 인부' },
  'dash.unitPeople': { en: '', ko: ' 명' },
  'dash.crewsRunning': { en: '7 crews', ko: '7개 조 운영' },
  'dash.avgDaily': { en: 'Avg Daily Deployment', ko: '일평균 투입' },
  'dash.attRate': { en: 'Attendance rate', ko: '출근율' },
  'dash.weeklyGross': { en: 'This Week Gross', ko: '이번 주 총지급(Gross)' },
  'dash.workedManHr': { en: 'Worked', ko: '근무' },
  'dash.totalDeductions': { en: 'Total Deductions', ko: '공제 합계' },
  'dash.deductNote': { en: 'SSS · PhilHealth · loans, etc.', ko: 'SSS·PhilHealth·대출 등' },
  'dash.manpowerTitle': { en: 'Daily Site Manpower (6/19–6/25)', ko: '일별 현장 투입 인력 (6/19~6/25)' },
  'dash.crewStatus': { en: 'Crew Status', ko: '조별 현황' },
  'dash.thCrew': { en: 'Crew (Foreman)', ko: '조 (반장)' },
  'dash.thHeadcount': { en: 'Headcount', ko: '인원' },
  'dash.thAvgAtt': { en: 'Avg Attendance', ko: '일평균 출근' },
  'dash.thAttRate': { en: 'Att. Rate', ko: '출근율' },
  'dash.thWeeklySub': { en: 'Weekly Subtotal', ko: '주급 소계' },
  'dash.thStatus': { en: 'Status', ko: '상태' },
  'dash.stOk': { en: 'Complete', ko: '집계완료' },
  'dash.stHalf': { en: 'Reviewing', ko: '검토중' },
  'dash.stAbs': { en: 'Short-staffed', ko: '인력부족' },
  'dash.crewClickHint': {
    en: '▸ Click a crew row to see its workers and their attendance / pay.',
    ko: '▸ 조를 클릭하면 소속 인부와 출근·급여 내역을 볼 수 있습니다.',
  },
  'dash.detName': { en: 'Name', ko: '성명' },
  'dash.detPosition': { en: 'Position', ko: '직급' },
  'dash.detPresent': { en: 'Days Present', ko: '출근일수' },
  'dash.detGross': { en: 'Gross', ko: '총지급' },
  'dash.overviewTitle': { en: 'Overall Summary', ko: '총괄 서머리' },
  'dash.matDeliveryKpi': { en: 'Material Delivery', ko: '자재 배달' },
  'dash.workProgressKpi': { en: 'Work Progress', ko: '작업 진행' },
  'dash.roomsDeliveredShort': { en: 'rooms delivered', ko: '개 방 배달완료' },
  'dash.itemsDoneShort': { en: 'items done', ko: '개 작업 완료' },
  'dash.matDeliveryTitle': { en: 'Material Delivery Status', ko: '자재 배달 현황' },
  'dash.workProgressTitle': { en: 'Work Progress Status', ko: '작업 진행 현황' },
  'dash.clickDetailHint': {
    en: '▸ Click an item to see the floor-by-floor breakdown.',
    ko: '▸ 항목을 클릭하면 층별 상세 내역을 볼 수 있습니다.',
  },
  'dash.thItem': { en: 'Item', ko: '항목' },
  'dash.thDelivered': { en: 'Delivered', ko: '배달완료' },
  'dash.thOngoing': { en: 'On the way', ko: '배달중' },
  'dash.thProgress': { en: 'Progress', ko: '진행률' },
  'dash.thDone': { en: 'Done', ko: '완료' },
  'dash.thInProgress': { en: 'In progress', ko: '진행중' },
  'dash.thFloor': { en: 'Floor', ko: '층' },
  'dash.thStage': { en: 'Stage', ko: '단계' },
  'dow.mon': { en: 'Mon', ko: '월' },
  'dow.tue': { en: 'Tue', ko: '화' },
  'dow.wed': { en: 'Wed', ko: '수' },
  'dow.thu': { en: 'Thu', ko: '목' },
  'dow.fri': { en: 'Fri', ko: '금' },
  'dow.sat': { en: 'Sat', ko: '토' },
  'dow.sun': { en: 'Sun', ko: '일' },

  // --- Attendance -----------------------------------------------------------
  'att.crewSelect': { en: 'Crew:', ko: '조 선택:' },
  'att.people': { en: '', ko: '명' },
  'att.date': { en: 'Date:', ko: '날짜:' },
  'att.excelImport': { en: 'Import Excel', ko: '엑셀 가져오기' },
  'att.saveDraft': { en: 'Save Draft', ko: '임시저장' },
  'att.confirm': { en: 'Confirm & Apply', ko: '확정 및 근태 반영' },
  'att.timeEntryTitle': {
    en: 'Time Entry — AM / PM / Overtime (OT)',
    ko: '출퇴근 시각 입력 — 오전(AM) / 오후(PM) / 초과(OT)',
  },
  'att.thName': { en: 'Name', ko: '성명' },
  'att.thPosition': { en: 'Position', ko: '직급' },
  'att.thWorkedH': { en: 'Worked (h)', ko: '근무(h)' },
  'att.thStatus': { en: 'Status', ko: '상태' },
  'att.stNormal': { en: 'Normal', ko: '정상' },
  'att.stHalf': { en: 'Half-day', ko: '반일' },
  'att.stAbsent': { en: 'Absent', ko: '결근' },
  'att.saved': { en: 'Attendance record saved.', ko: '출퇴근 기록이 저장되었습니다.' },
  'att.saveError': { en: 'An error occurred while saving.', ko: '저장 중 오류가 발생했습니다.' },
  'att.imported': { en: 'Imported rows:', ko: '가져온 인원:' },
  'att.importEmpty': { en: 'The file has no data rows.', ko: '파일에 데이터 행이 없습니다.' },
  'att.importNoName': {
    en: 'Could not find a "Name" column in the file.',
    ko: '파일에서 "Name(성명)" 열을 찾을 수 없습니다.',
  },
  'att.importError': { en: 'Failed to read the file.', ko: '파일을 읽지 못했습니다.' },
  'att.note': {
    en: '※ Enter times in 24-hour format (e.g. 7 = 07:00, 13 = 13:00). On save, worked hours, tardiness, OT and night differential are auto-aggregated into payroll.',
    ko: '※ 시각은 24시간제로 입력(예: 7 = 오전 7시, 13 = 오후 1시). 저장 시 근무시간·지각·OT·야간이 자동 집계되어 급여 계산에 반영됩니다.',
  },

  // --- Payroll --------------------------------------------------------------
  'pay.step1': { en: '① Confirm Attendance', ko: '① 출퇴근 확정' },
  'pay.step2': { en: '② Aggregate', ko: '② 근태 집계' },
  'pay.step3': { en: '③ Calculate Payroll', ko: '③ 급여 계산' },
  'pay.step4': { en: '④ Review · Approve', ko: '④ 검토·승인' },
  'pay.step5': { en: '⑤ Issue Payslip', ko: '⑤ 명세서 발급' },
  'pay.periodLabel': { en: 'Pay period:', ko: '급여기간:' },
  'pay.allCrews': { en: 'All Crews', ko: '전체 조' },
  'pay.excelExport': { en: 'Export Excel', ko: '엑셀 내보내기' },
  'pay.recalc': { en: 'Recalculate', ko: '재계산' },
  'pay.recalcBusy': { en: 'Calculating…', ko: '계산 중…' },
  'pay.requestApproval': { en: 'Request Approval', ko: '승인 요청' },
  'pay.approvalConfirm': {
    en: 'Send this payroll for approval?',
    ko: '이 급여 내역을 승인 요청하시겠습니까?',
  },
  'pay.approvalRequested': {
    en: 'Approval request sent.',
    ko: '승인 요청이 전송되었습니다.',
  },
  'pay.title': {
    en: 'Payroll Sheet — sample at ₱540/day',
    ko: '급여표 (Payroll Sheet) — 단가 ₱540/일 기준 예시',
  },
  'pay.thName': { en: 'Name', ko: '성명' },
  'pay.thPosition': { en: 'Position', ko: '직급' },
  'pay.thWorkDays': { en: 'Work Days', ko: '근무일' },
  'pay.thBasic': { en: 'Basic', ko: '기본급' },
  'pay.thOt': { en: 'OT', ko: 'OT' },
  'pay.thNight': { en: 'Night', ko: '야간' },
  'pay.thHoliday': { en: 'Holiday', ko: '휴일' },
  'pay.thIncentive': { en: 'Incentive', ko: '인센' },
  'pay.thGross': { en: 'Gross', ko: '총지급' },
  'pay.thOtherDeduct': { en: 'Other', ko: '기타공제' },
  'pay.thNet': { en: 'Net Pay', ko: '실지급(Net)' },
  'pay.total': { en: 'Total', ko: '합계' },
  'pay.totalUnit': { en: '', ko: '명' },
  'pay.note': {
    en: '※ OT/night/holiday premium rates and deduction tables are managed on the Settings screen and applied automatically by the calc engine.',
    ko: '※ OT·야간·휴일 할증률과 공제표는 규칙 설정 화면에서 관리되며, 계산엔진이 자동 적용합니다.',
  },

  // --- Payslip --------------------------------------------------------------
  'slip.worker': { en: 'Worker:', ko: '인부:' },
  'slip.batchPdf': { en: 'Batch PDF (143)', ko: '전체 일괄 PDF (143명)' },
  'slip.printPdf': { en: 'Print this Payslip PDF', ko: '이 명세서 PDF 인쇄' },
  'slip.name': { en: 'Name', ko: '성명' },
  'slip.position': { en: 'Position', ko: '직급' },
  'slip.crew': { en: 'Crew', ko: '소속 조' },
  'slip.dailyRate': { en: 'Daily Rate', ko: '일당' },
  'slip.payPeriod': { en: 'Pay Period', ko: '급여기간' },
  'slip.payDate': { en: 'Pay Date', ko: '지급일' },
  'slip.earnings': { en: 'Earnings', ko: '지급 항목 (Earnings)' },
  'slip.amount': { en: 'Amount', ko: '금액' },
  'slip.deductions': { en: 'Deductions', ko: '공제 (Deductions)' },
  'slip.gross': { en: 'Gross', ko: '총지급 (Gross)' },
  'slip.totalDeduct': { en: 'Total Deductions', ko: '공제 합계' },
  'slip.netPay': { en: 'NET PAY', ko: '실지급액 (NET PAY)' },

  // --- Employees ------------------------------------------------------------
  'emp.searchPlaceholder': { en: '🔍 Search name', ko: '🔍 이름 검색' },
  'emp.allPositions': { en: 'All Positions', ko: '전체 직급' },
  'emp.addWorker': { en: '+ Add Worker', ko: '+ 인부 등록' },
  'emp.masterTitle': { en: 'Worker Master', ko: '인부 마스터' },
  'emp.masterUnit': { en: 'workers', ko: '명' },
  'emp.thEmpNo': { en: 'Emp No', ko: '사번' },
  'emp.thPhoto': { en: 'Photo', ko: '사진' },
  'emp.thName': { en: 'Name', ko: '성명' },
  'emp.thNickname': { en: 'Nickname', ko: '닉네임' },
  'emp.thAge': { en: 'Age', ko: '나이' },
  'emp.thId': { en: 'ID', ko: '아이디' },
  'emp.thPosition': { en: 'Position', ko: '직급' },
  'emp.thCrew': { en: 'Crew', ko: '소속 조' },
  'emp.thDailyRate': { en: 'Daily Rate', ko: '일당' },
  'emp.thJoinDate': { en: 'Join Date', ko: '입사일' },
  'emp.thSssNo': { en: 'SSS No.', ko: 'SSS 번호' },
  'emp.noData': { en: 'No worker data.', ko: '인부 정보가 없습니다.' },
  'emp.showingNote': {
    en: 'Showing first 50 workers. Use search to filter.',
    ko: '첫 50명만 표시됩니다. 검색으로 필터링하세요.',
  },
  'emp.showingCount': { en: 'of', ko: '명 중' },

  // --- Settings -------------------------------------------------------------
  'set.loading': { en: 'Loading...', ko: '로딩 중...' },
  'set.loadError': { en: 'Could not load settings.', ko: '설정을 불러올 수 없습니다.' },
  'set.otTitle': {
    en: 'Overtime · Holiday Premium Rules (managed by config)',
    ko: '초과근무·휴일 할증 규칙 (설정값으로 관리)',
  },
  'set.thType': { en: 'Type', ko: '구분' },
  'set.thMultiplier': { en: 'Rate / Multiplier', ko: '요율 / 배수' },
  'set.thCondition': { en: 'Condition', ko: '적용 조건' },
  'set.regularOt': { en: 'Regular OT', ko: '평일 초과근무 (Regular OT)' },
  'set.regularOtCond': { en: 'Hourly × rate, per OT hour (1.25 = +25%)', ko: '시간당 × 배수, OT 1시간당 (1.25 = +25%)' },
  'set.drd': { en: 'Rest-day work (DRD)', ko: '휴무일 근무 (DRD)' },
  'set.drdCond': { en: 'Per rest day worked: daily rate × rate (0.30 = +30%)', ko: '휴무일 근무 1일당: 일당 × 요율 (0.30 = +30%)' },
  'set.specialHoliday': { en: 'Special Holiday', ko: '특별공휴일' },
  'set.specialHolidayCond': { en: 'Per day: daily rate × rate (0.30 = +30%)', ko: '1일당: 일당 × 요율 (0.30 = +30%)' },
  'set.legalHoliday': { en: 'Legal Holiday', ko: '법정공휴일' },
  'set.legalHolidayCond': { en: 'Per day: daily rate × rate (1.00 = full day)', ko: '1일당: 일당 × 요율 (1.00 = 1일분)' },
  'set.nightDiff': { en: 'Night Differential (regular)', ko: '야간 수당 (정규)' },
  'set.nightWindow': { en: 'Night window', ko: '야간 시간대' },
  'set.otNote': {
    en: '※ Calibrated to the BRIGHTEM weekly payroll sheet: OT is an hourly multiplier; DRD and holiday pay are day-based premiums on the daily rate. Editing values applies to the calc engine immediately.',
    ko: '※ BRIGHTEM 주급 시트 기준으로 보정됨: 초과근무는 시간당 배수, DRD·휴일 수당은 일당 기준 일별 할증입니다. 값만 수정하면 계산엔진에 즉시 반영됩니다.',
  },
  'set.statutoryTitle': { en: 'Statutory Deductions', ko: '법정 공제 (Statutory Deductions)' },
  'set.thItem': { en: 'Item', ko: '항목' },
  'set.thMethod': { en: 'Method', ko: '산정 방식' },
  'set.thRemark': { en: 'Remark', ko: '비고' },
  'set.sssMethod': { en: 'Contribution table by salary bracket', ko: '급여 구간별 기여금표' },
  'set.rateMethod': { en: 'Salary × rate', ko: '급여 × 요율' },
  'set.clientProvide': { en: 'Client to provide', ko: '회사 확정값 입력 필요 (Client to provide)' },
  'set.loan': { en: 'Loans (Salary/Calamity)', ko: '대출 (Salary/Calamity)' },
  'set.loanMethod': { en: 'Installment amount', ko: '분할 상환액' },
  'set.loanRemark': { en: 'Auto balance tracking', ko: '잔액 자동 추적' },
  'set.statutoryNote': {
    en: '※ The WEEKLY run deducts no SSS/PhilHealth/Pag-IBIG — matching the company sheet, these are collected on a separate monthly cycle. Add tables here to enable monthly deductions.',
    ko: '※ 주급 정산에서는 SSS/PhilHealth/Pag-IBIG를 공제하지 않습니다 — 회사 시트와 동일하게 이 항목들은 별도 월 단위로 징수됩니다. 월 공제를 적용하려면 여기에 기여금표를 추가하세요.',
  },
  'set.otherTitle': { en: 'Other Settings', ko: '기타 설정' },
  'set.incentiveRate': { en: 'Default Incentive Daily Rate', ko: '기본 인센티브 일당 (Default Daily Rate)' },
  'set.perWorkedDay': { en: '₱ per day present · fallback when an employee has no rate set', ko: '₱ / 출근 1일당 · 직원별 요율 미설정 시 기본값' },
  'set.stdHours': { en: 'Standard Daily Hours', ko: '표준 일평균 근무시간' },
  'set.hours': { en: 'hours', ko: 'hours' },
  'set.cancel': { en: 'Cancel', ko: '취소' },
  'set.save': { en: 'Save Settings', ko: '설정 저장' },
  'set.saving': { en: 'Saving...', ko: '저장 중...' },
  'set.saved': { en: 'Settings saved.', ko: '설정이 저장되었습니다.' },
  'set.saveError': { en: 'An error occurred while saving.', ko: '저장 중 오류가 발생했습니다.' },
} satisfies Record<string, Entry>;

export type TKey = keyof typeof DICT;

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readInitialLang(): Lang {
  try {
    const saved = localStorage.getItem('brightem.lang');
    if (saved === 'en' || saved === 'ko') return saved;
  } catch {
    /* ignore */
  }
  return 'en'; // English is the default
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('brightem.lang', l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: TKey) => {
      const entry = DICT[key];
      if (!entry) return key;
      return entry[lang] || entry.en;
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}
