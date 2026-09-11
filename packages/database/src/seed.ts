import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  if (await prisma.organization.findUnique({ where: { code: 'TECHCORP' } })) {
    console.log('Demo organization already exists; seed skipped to preserve existing data.');
    return;
  }
  console.log('🌱 Bắt đầu khởi tạo dữ liệu mẫu (Seed Database)...');

  // 1. Tạo tổ chức chính
  const org = await prisma.organization.upsert({
    where: { code: 'TECHCORP' },
    update: {},
    create: {
      name: 'TechCorp Vietnam',
      code: 'TECHCORP',
      settings: JSON.stringify({
        timezone: 'Asia/Ho_Chi_Minh',
        weekStartsOn: 1, // Thứ Hai
        allowAdminReadPrivateChat: true,
        workloadOverloadThreshold: 8
      })
    }
  });

  console.log(`✅ Tổ chức: ${org.name} (${org.code})`);

  // Mật khẩu chung cho tài khoản demo: "Admin@123456"
  const passwordHash = await bcrypt.hash('Admin@123456', 10);

  // 2. Tạo Admin
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@techcorp.vn' },
    update: {},
    create: {
      orgId: org.id,
      email: 'admin@techcorp.vn',
      fullName: 'Quản Trị Viên (Admin)',
      passwordHash,
      systemRole: 'ADMIN',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=admin'
    }
  });

  // 3. Tạo các thành viên theo prompt.txt: Sang, Lợi, Hy
  const sangUser = await prisma.user.upsert({
    where: { email: 'sang@techcorp.vn' },
    update: {},
    create: {
      orgId: org.id,
      email: 'sang@techcorp.vn',
      fullName: 'Nguyễn Văn Sang',
      passwordHash,
      systemRole: 'MEMBER',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sang'
    }
  });

  const loiUser = await prisma.user.upsert({
    where: { email: 'loi@techcorp.vn' },
    update: {},
    create: {
      orgId: org.id,
      email: 'loi@techcorp.vn',
      fullName: 'Trần Văn Lợi',
      passwordHash,
      systemRole: 'MEMBER',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=loi'
    }
  });

  const hyUser = await prisma.user.upsert({
    where: { email: 'hy@techcorp.vn' },
    update: {},
    create: {
      orgId: org.id,
      email: 'hy@techcorp.vn',
      fullName: 'Lê Gia Hy',
      passwordHash,
      systemRole: 'MEMBER',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=hy'
    }
  });

  console.log('✅ Đã tạo các tài khoản: Admin, Sang, Lợi, Hy (Mật khẩu: Admin@123456)');

  // 4. Tạo các Team: Social, Web, Product, Tool
  const teamSocial = await prisma.team.create({
    data: {
      orgId: org.id,
      name: 'Social Team',
      description: 'Phụ trách truyền thông, video và thiết kế hình ảnh',
      members: {
        create: [
          { userId: adminUser.id, role: 'LEAD' },
          { userId: loiUser.id, role: 'MEMBER' },
          { userId: sangUser.id, role: 'MEMBER' }
        ]
      }
    }
  });

  const teamWeb = await prisma.team.create({
    data: {
      orgId: org.id,
      name: 'Web Team',
      description: 'Phụ trách phát triển web và các landing page',
      members: {
        create: [
          { userId: sangUser.id, role: 'LEAD' },
          { userId: hyUser.id, role: 'MEMBER' }
        ]
      }
    }
  });

  console.log('✅ Đã tạo các Team: Social Team, Web Team');

  // 5. Tạo các Projects: Jeminise, Wrydeco, Chillgen
  const projJeminise = await prisma.project.create({
    data: {
      orgId: org.id,
      teamId: teamWeb.id,
      name: 'Jeminise E-Commerce',
      code: 'JEMINISE',
      members: {
        create: [
          { userId: sangUser.id },
          { userId: hyUser.id }
        ]
      }
    }
  });

  const projWrydeco = await prisma.project.create({
    data: {
      orgId: org.id,
      teamId: teamSocial.id,
      name: 'Wrydeco Branding',
      code: 'WRYDECO',
      members: {
        create: [
          { userId: loiUser.id },
          { userId: sangUser.id }
        ]
      }
    }
  });

  console.log('✅ Đã tạo các Project: Jeminise, Wrydeco');

  // 6. Tạo Hội thoại chung cho các Team
  const socialConv = await prisma.conversation.create({
    data: {
      orgId: org.id,
      type: 'TEAM',
      name: 'Kênh Social Team',
      teamId: teamSocial.id,
      members: {
        create: [
          { userId: adminUser.id, role: 'ADMIN' },
          { userId: loiUser.id, role: 'MEMBER' },
          { userId: sangUser.id, role: 'MEMBER' }
        ]
      }
    }
  });

  const webConv = await prisma.conversation.create({
    data: {
      orgId: org.id,
      type: 'TEAM',
      name: 'Kênh Web Team',
      teamId: teamWeb.id,
      members: {
        create: [
          { userId: sangUser.id, role: 'ADMIN' },
          { userId: hyUser.id, role: 'MEMBER' }
        ]
      }
    }
  });

  console.log('✅ Đã tạo phòng Chat mặc định cho Social Team và Web Team');

  // 7. Tạo một số Task mẫu ban đầu
  const tomorrow5pm = new Date();
  tomorrow5pm.setDate(tomorrow5pm.getDate() + 1);
  tomorrow5pm.setHours(17, 0, 0, 0);

  await prisma.task.create({
    data: {
      orgId: org.id,
      teamId: teamSocial.id,
      projectId: projWrydeco.id,
      title: 'Dựng video giới thiệu Wrydeco 60s',
      description: 'Làm video recap ngắn gọn, phong cách hiện đại cho chiến dịch ra mắt.',
      assigneeId: loiUser.id,
      creatorId: adminUser.id,
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      deadline: tomorrow5pm
    }
  });

  await prisma.task.create({
    data: {
      orgId: org.id,
      teamId: teamWeb.id,
      projectId: projJeminise.id,
      title: 'Fix UI Jeminise PDP màn hình mobile',
      description: 'Chỉnh lại nút Mua ngay và carousel ảnh trên màn hình iPhone.',
      assigneeId: sangUser.id,
      creatorId: adminUser.id,
      priority: 'NORMAL',
      status: 'IN_PROGRESS',
      deadline: tomorrow5pm
    }
  });

  // 8. Khởi tạo trạng thái Đang làm mẫu (Current Work)
  await prisma.currentWork.upsert({
    where: { userId: sangUser.id },
    update: {},
    create: {
      userId: sangUser.id,
      customStatusText: 'Fix UI Jeminise PDP'
    }
  });

  await prisma.currentWork.upsert({
    where: { userId: loiUser.id },
    update: {},
    create: {
      userId: loiUser.id,
      customStatusText: 'Edit video Wrydeco'
    }
  });

  console.log('🎉 Khởi tạo dữ liệu mẫu hoàn tất thành công 100%!');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi khởi tạo seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
