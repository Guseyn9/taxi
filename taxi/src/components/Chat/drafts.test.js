import {readChatDraft,saveChatDraft} from './drafts'
beforeEach(()=>{sessionStorage.clear();localStorage.clear()})
test('retains typed and unconfirmed text across reopening, isolates accounts/orders and logout',()=>{
 saveChatDraft('1419_1;1420_1',{draft:'new text',unconfirmed:'not acknowledged'})
 expect(readChatDraft('1419_1;1420_1')).toEqual({draft:'new text',unconfirmed:'not acknowledged'})
 expect(readChatDraft('1419_2;1420_2').draft).toBe('')
 localStorage.setItem('taxi.auth.revocation','new-login');expect(readChatDraft('1419_1;1420_1').draft).toBe('')
})
