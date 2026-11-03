export function accountStatusLabel(status?: string): string {
  switch (status) {
    case 'approved':
      return '已批准'
    case 'pending':
      return '待审核'
    case 'rejected':
      return '已拒绝'
    case 'unregistered':
      return '未注册'
    default:
      return '-'
  }
}
