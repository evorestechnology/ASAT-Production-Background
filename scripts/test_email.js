import { sendAdminInviteEmail } from '../src/utils/mailer.js';

async function testEmail() {
  console.log('Testing email delivery to ptejanvk@gmail.com...');
  const result = await sendAdminInviteEmail(
    'ptejanvk@gmail.com',
    'Teja',
    'admin',
    'https://as-simple-as-that.com/master/login'
  );
  console.log('Result:', result);
}

testEmail();
