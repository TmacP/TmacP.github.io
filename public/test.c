#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>

int main(void)
{
    // Create and open the directory
    mkdir("tmpdir", 0755);
    int dir_fd = open(".", O_RDONLY);

    if (chroot("tmpdir") != 0) {
        perror("chroot");
        return 1;
    }

    // Change directory to root inside the new chroot
    if (chdir("/") != 0) {
        perror("chdir");
        return 1;
    }

    // Now try to traverse up (this won't work if chroot is effective)
    for (int x = 0; x < 1000; x++) {
        if (chdir("..") != 0) {
            perror("chdir");
            break;
        }
    }

    // Attempt to revert chroot to current directory (if possible)
    if (chroot(".") != 0) {
        perror("chroot");
        return 1;
    }

    return 0;
}
